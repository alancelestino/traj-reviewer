import React, { useState, useEffect } from 'react';
import './App.css';
import Chat from './Chat';

function App() {
  const [trajectory, setTrajectory] = useState([]);
  const [filteredTrajectory, setFilteredTrajectory] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [fileName, setFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [semanticFilter, setSemanticFilter] = useState(null);
  const [chatKey, setChatKey] = useState(0);
  const [fileContent, setFileContent] = useState('');
  const [modifiedContent, setModifiedContent] = useState('');
  const [replaceSearch, setReplaceSearch] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [editingStep, setEditingStep] = useState(null);
  const [editedThought, setEditedThought] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [generatingThought, setGeneratingThought] = useState(null);

  const getStepText = (value, isStepZero = false) => {
    if (!value) return '';
    if (isStepZero) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'text' in value[0]) {
            return value[0].text;
        }
    }
    if (typeof value === 'object' && value.text) return value.text;
    if (typeof value === 'string') return value;
    return '';
  };

  // Helper function to escape regex special characters
  const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Helper function to debug content structure
  const debugContentStructure = (content, stepIndex) => {
    console.log(`=== Debug Content Structure for Step ${stepIndex} ===`);
    try {
      const parsed = JSON.parse(content);
      if (parsed.trajectory && Array.isArray(parsed.trajectory)) {
        const step = parsed.trajectory[stepIndex - 1]; // Adjust for 0-based index
        if (step) {
          console.log('Step object:', step);
          console.log('Thought field:', step.thought);
          console.log('Thought type:', typeof step.thought);
          console.log('Thought length:', step.thought?.length);
          if (typeof step.thought === 'object') {
            console.log('Thought object keys:', Object.keys(step.thought || {}));
          }
        } else {
          console.log(`Step ${stepIndex} not found in trajectory`);
        }
      } else {
        console.log('No trajectory array found in content');
      }
    } catch (error) {
      console.log('Error parsing content:', error);
    }
    console.log('=== End Debug ===');
  };

  useEffect(() => {
    const keywordSearchTerms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);

    let newFiltered = trajectory;

    if (keywordSearchTerms.length > 0) {
      newFiltered = newFiltered.filter(step => {
        const content = step.isStepZero
            ? getStepText(step.content, true).toLowerCase()
            : [getStepText(step.thought), getStepText(step.action), getStepText(step.observation)]
                .join(' ')
                .toLowerCase();
        return keywordSearchTerms.some(term => content.includes(term));
      });
    }

    if (semanticFilter) {
      const semanticIndices = new Set(semanticFilter.map(sf => sf.originalIndex));
      newFiltered = newFiltered.filter(step => semanticIndices.has(step.originalIndex));
      
      // Attach reasoning to the filtered steps
      const reasoningMap = new Map(semanticFilter.map(sf => [sf.originalIndex, sf.reasoning]));
      newFiltered = newFiltered.map(step => ({
        ...step,
        reasoning: reasoningMap.get(step.originalIndex)
      }));
    }

    setFilteredTrajectory(newFiltered);
    
    // Only reset to first step if we don't have a current step or if current step is not in filtered results
    if (currentIndex >= newFiltered.length || newFiltered.length === 0) {
      setCurrentIndex(0);
    } else {
      // Try to keep the same step if it's still available in filtered results
      const currentStep = filteredTrajectory[currentIndex];
      if (currentStep) {
        const newIndex = newFiltered.findIndex(step => step.originalIndex === currentStep.originalIndex);
        if (newIndex !== -1) {
          setCurrentIndex(newIndex);
        } else {
          setCurrentIndex(0);
        }
      } else {
        setCurrentIndex(0);
      }
    }
  }, [searchQuery, trajectory, semanticFilter, currentIndex, filteredTrajectory]);

  // Separate effect to handle position restoration when filters are cleared
  useEffect(() => {
    // Only run when filters are completely cleared
    if (!searchQuery.trim() && !semanticFilter) {
      console.log('Filters cleared - staying at current filtered position');
      
      // Find the current filtered step in the unfiltered trajectory
      if (filteredTrajectory.length > 0 && currentIndex < filteredTrajectory.length) {
        const currentFilteredStep = filteredTrajectory[currentIndex];
        if (currentFilteredStep) {
          // Find this step in the unfiltered trajectory
          const unfilteredIndex = trajectory.findIndex(step => step.originalIndex === currentFilteredStep.originalIndex);
          if (unfilteredIndex !== -1) {
            console.log('Staying at step with original index:', currentFilteredStep.originalIndex);
            // Keep the same currentIndex since we're staying on the same step
          } else {
            console.log('Current filtered step not found in unfiltered trajectory, resetting to 0');
            setCurrentIndex(0);
          }
        }
      }
    }
  }, [filteredTrajectory, searchQuery, semanticFilter, trajectory, currentIndex]);

  const loadTrajectory = (contentString, clearModifiedContent = true) => {
    console.log('loadTrajectory called, clearModifiedContent:', clearModifiedContent);
    console.log('Content string length:', contentString?.length);
    console.log('Current modifiedContent before load:', modifiedContent);
    
    try {
      const data = JSON.parse(contentString);
      let processedTrajectory = [];

      // Handle Step 0 from history
      if (data.history && data.history.length > 1) {
        processedTrajectory.push({
          ...data.history[1],
          originalIndex: 0,
          isStepZero: true,
        });
      }

      // Handle the rest of the trajectory
      if (data.trajectory && Array.isArray(data.trajectory)) {
        const trajectoryWithOriginalIndex = data.trajectory.map((step, index) => ({
          ...step,
          originalIndex: index + 1
        }));
        processedTrajectory = [...processedTrajectory, ...trajectoryWithOriginalIndex];
      }
      
      setTrajectory(processedTrajectory);
      // Reset all filters and the chat component
      handleClearFilters();
      setChatKey(key => key + 1);
      setHasUnsavedChanges(false);
      
      if (clearModifiedContent) {
        setModifiedContent(''); // Clear any previous modifications
        console.log('Cleared modifiedContent in loadTrajectory');
      } else {
        console.log('Preserved modifiedContent in loadTrajectory');
      }
    } catch (error) {
      alert('Error parsing JSON file.');
      console.error("File parsing error:", error);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        setFileContent(content);
        setModifiedContent(''); // Clear any previous modifications
        loadTrajectory(content);
      };
      reader.readAsText(file);
    }
  };

  const handleReplace = async () => {
    if (!replaceSearch) {
      alert('Please enter a search term for replacement.');
      return;
    }
    
    console.log('handleReplace called');
    console.log('replaceSearch:', replaceSearch);
    console.log('replaceWith:', replaceWith);
    console.log('Current modifiedContent:', modifiedContent);
    console.log('Current fileContent length:', fileContent?.length);
    
    try {
      const response = await fetch('http://localhost:5001/replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: modifiedContent || fileContent,
          search_term: escapeRegExp(replaceSearch),
          replace_term: replaceWith,
        }),
      });
      const data = await response.json();
      console.log('Replace response:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      console.log('Setting modifiedContent to:', data.modified_content?.substring(0, 100) + '...');
      setModifiedContent(data.modified_content);
      loadTrajectory(data.modified_content, false); // Don't clear modifiedContent
      alert('Replacement successful!');
      setHasUnsavedChanges(true);
    } catch (error) {
      alert(`Replacement failed: ${error.message}`);
    }
  };

  const handleSave = async () => {
    console.log('handleSave called');
    console.log('modifiedContent exists:', !!modifiedContent);
    console.log('modifiedContent length:', modifiedContent?.length);
    console.log('fileContent length:', fileContent?.length);
    console.log('hasUnsavedChanges:', hasUnsavedChanges);
    
    let contentToSave;
    
    if (modifiedContent) {
      // Use the modified content from search & replace or thought edits
      contentToSave = modifiedContent;
      console.log('Using modifiedContent for save');
    } else {
      // No modifications to save
      console.log('No modifiedContent, showing alert');
      alert('No changes to save.');
      return;
    }

    // Prompt for filename with "modified_" prefix as default
    const defaultFileName = `modified_${fileName}`;
    const newFileName = prompt("Enter new file name:", defaultFileName);
    
    if (!newFileName) {
      console.log('User cancelled save');
      return;
    }

    try {
      console.log('Sending save request with content length:', contentToSave.length);
      const response = await fetch('http://localhost:5001/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToSave,
          filename: newFileName,
        }),
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      console.log("Save response:", data);
      alert(data.message);
      setHasUnsavedChanges(false);
      // Update fileContent to reflect the saved state
      setFileContent(contentToSave);
      setModifiedContent(''); // Clear modified content after successful save
    } catch (error) {
      console.error("Save error:", error);
      alert(`Save failed: ${error.message}`);
    }
  };

  const handleEditThought = (stepIndex) => {
    const step = filteredTrajectory[stepIndex];
    setEditingStep(step.originalIndex);
    setEditedThought(getStepText(step.thought));
  };

  const handleSaveThought = async () => {
    try {
      console.log('handleSaveThought called');
      console.log('Current modifiedContent:', modifiedContent);
      console.log('Current fileContent length:', fileContent?.length);
      console.log('Editing step:', editingStep);
      console.log('Edited thought:', editedThought);
      
      // Get the current step's thought for debugging
      const currentStepObj = filteredTrajectory.find(step => step.originalIndex === editingStep);
      const originalThought = getStepText(currentStepObj?.thought);
      console.log('Original thought from currentStep:', originalThought);
      console.log('Original thought length:', originalThought?.length);
      console.log('Edited thought length:', editedThought?.length);
      
      // Debug the content structure to see what we're working with
      debugContentStructure(modifiedContent || fileContent, editingStep);
      
      // Check if the thoughts are actually different
      if (originalThought === editedThought) {
        console.log('Thoughts are identical - no change needed');
        alert('No changes detected in the thought.');
        setEditingStep(null);
        setEditedThought('');
        return;
      }
      
      const contentToUpdate = modifiedContent || fileContent;

      // Use JSON-safe endpoint to update this trajectory step's thought
      const response = await fetch('http://localhost:5001/replace_thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToUpdate,
          original_index: editingStep,
          old_thought: originalThought,
          new_thought: editedThought,
        }),
      });

      const data = await response.json();
      console.log('replace_thought response:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Update the modified content
      setModifiedContent(data.modified_content);
      
      // Reload the trajectory with the updated content
      loadTrajectory(data.modified_content, false); // Don't clear modifiedContent
      
      // Reset edit state
      setEditingStep(null);
      setEditedThought('');
      setHasUnsavedChanges(true);
      
      alert('Thought updated successfully!');
    } catch (error) {
      console.error('Error updating thought:', error);
      alert(`Failed to update thought: ${error.message}`);
    }
  };

  const handleCancelEdit = () => {
    setEditingStep(null);
    setEditedThought('');
  };

  const handleGenerateThought = async (stepIndex) => {
    const currentStep = filteredTrajectory[stepIndex];
    setGeneratingThought(currentStep.originalIndex);

    try {
      console.log('handleGenerateThought called');
      console.log('Current modifiedContent:', modifiedContent);
      console.log('Current fileContent length:', fileContent?.length);
      console.log('Current step thought:', getStepText(currentStep.thought));
      
      // Get previous steps (all steps up to the current one)
      const previousSteps = trajectory.filter(step => 
        step.originalIndex < currentStep.originalIndex
      );

      // Get the tool call from the action (assuming action contains the tool call)
      const toolCall = getStepText(currentStep.action);

      const response = await fetch('http://localhost:5001/generate_thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_step: currentStep,
          previous_steps: previousSteps,
          tool_call: toolCall
        }),
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      console.log('Generate thought response:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }

      const originalThought = getStepText(currentStep.thought);
      const contentToUpdate = modifiedContent || fileContent;

      // JSON-safe update of the specific step's thought
      const replaceResponse = await fetch('http://localhost:5001/replace_thought', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToUpdate,
          original_index: currentStep.originalIndex,
          old_thought: originalThought,
          new_thought: data.generated_thought,
        }),
      });

      const replaceData = await replaceResponse.json();
      console.log('replace_thought response:', replaceData);
      
      if (replaceData.error) {
        throw new Error(replaceData.error);
      }

      // Update the modified content
      setModifiedContent(replaceData.modified_content);
      
      // Reload the trajectory with the updated content
      loadTrajectory(replaceData.modified_content, false); // Don't clear modifiedContent
      
      setHasUnsavedChanges(true);
      alert('Thought generated and updated successfully!');

    } catch (error) {
      console.error('Error generating thought:', error);
      alert(`Failed to generate thought: ${error.message}`);
    } finally {
      setGeneratingThought(null);
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSemanticFilter(null);
    // The useEffect will handle position restoration automatically
  };

  const goToPrevious = () => {
    setCurrentIndex((prevIndex) => (prevIndex > 0 ? prevIndex - 1 : 0));
  };

  const goToNext = () => {
    setCurrentIndex((prevIndex) =>
      prevIndex < filteredTrajectory.length - 1 ? prevIndex + 1 : prevIndex
    );
  };

  const handleSemanticFilter = (filteredSteps) => {
    setSemanticFilter(filteredSteps);
  };

  const highlightMatches = (text, isStepZero = false) => {
    const stringText = getStepText(text, isStepZero);

    const searchTerms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) {
      return stringText;
    }
    const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi');
    return stringText.split(regex).map((part, index) => {
        if (searchTerms.some(term => part.toLowerCase() === term)) {
            return <mark key={index}>{part}</mark>;
        }
        return part;
    });
  };

  const currentStep = filteredTrajectory[currentIndex];

  return (
    <div className="App">
      <div className="main-layout">
        <div className="trajectory-viewer-container">
          <header className="App-header">
            <h1>Trajectory Viewer</h1>
            <div className="controls-container">
              <div className="file-upload-container">
                <input type="file" id="file-upload" onChange={handleFileUpload} accept=".json" />
                <label htmlFor="file-upload" className="file-upload-button">
                  Upload JSON
                </label>
                {fileName && <span className="file-name">{fileName}</span>}
              </div>
              <div className="search-container">
                <input
                  type="text"
                  placeholder="Filter by keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {(searchQuery || semanticFilter) && (
                    <button onClick={handleClearFilters} className="clear-filter-button">
                        Clear Filters
                    </button>
                )}
              </div>
            </div>
          </header>
          <div className="replace-container">
              <input 
                type="text"
                placeholder="Search for..."
                value={replaceSearch}
                onChange={(e) => setReplaceSearch(e.target.value)}
              />
              <input 
                type="text"
                placeholder="Replace with..."
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
              />
              <button onClick={handleReplace} disabled={!fileContent}>Replace All</button>
              {(modifiedContent || hasUnsavedChanges) && (
                <button onClick={handleSave} className="save-button">Save Modified</button>
              )}
          </div>
          <main className="App-main">
            {filteredTrajectory.length > 0 && currentStep ? (
              <div className="trajectory-step">
                <div className="step-info">
                  Step {currentStep.originalIndex} of {trajectory.length - 1}
                  {(searchQuery.trim() || semanticFilter) &&
                    <span className="filtered-count">
                      {' '}(match {currentIndex + 1} of {filteredTrajectory.length})
                    </span>
                  }
                </div>
                <div className="navigation-buttons">
                  <button onClick={goToPrevious} disabled={currentIndex === 0}>
                    Previous
                  </button>
                  <button onClick={goToNext} disabled={currentIndex === filteredTrajectory.length - 1}>
                    Next
                  </button>
                </div>
                {currentStep.isStepZero ? (
                  <div className="step-content">
                    <div className="step-item step-zero">
                      <h2>User Instructions (Step 0)</h2>
                      <p>{highlightMatches(currentStep.content, true)}</p>
                    </div>
                  </div>
                ) : (
                  <div className="step-content">
                    {currentStep.reasoning && (
                      <div className="step-item reasoning">
                        <h2>Reasoning</h2>
                        <p>{currentStep.reasoning}</p>
                      </div>
                    )}
                    <div className="step-item">
                      <div className="step-header">
                        <h2>Thought</h2>
                        {editingStep === currentStep.originalIndex ? (
                          <div className="edit-buttons">
                            <button onClick={handleSaveThought} className="save-edit-btn">Save</button>
                            <button onClick={handleCancelEdit} className="cancel-edit-btn">Cancel</button>
                          </div>
                        ) : (
                          <div className="edit-buttons">
                            <button onClick={() => handleEditThought(currentIndex)} className="edit-btn">Edit</button>
                            <button onClick={() => handleGenerateThought(currentIndex)} className="generate-edit-btn" disabled={generatingThought === currentStep.originalIndex}>
                              {generatingThought === currentStep.originalIndex ? 'Generating...' : 'Generate with AI'}
                            </button>
                          </div>
                        )}
                      </div>
                      {editingStep === currentStep.originalIndex ? (
                        <textarea
                          value={editedThought}
                          onChange={(e) => setEditedThought(e.target.value)}
                          className="thought-editor"
                          rows={6}
                        />
                      ) : (
                        <p>{highlightMatches(currentStep.thought)}</p>
                      )}
                    </div>
                    <div className="step-item">
                      <h2>Action</h2>
                      <p>{highlightMatches(currentStep.action)}</p>
                    </div>
                    <div className="step-item">
                      <h2>Observation</h2>
                      <p>{highlightMatches(currentStep.observation)}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="no-data-message">
                <p>
                  {trajectory.length > 0
                    ? "No steps match your search criteria."
                    : "Please upload a trajectory JSON file to begin."}
                </p>
              </div>
            )}
          </main>
        </div>
        <div className="chat-pane">
          <Chat key={chatKey} trajectory={trajectory} onFilter={handleSemanticFilter} />
        </div>
      </div>
    </div>
  );
}

export default App;
