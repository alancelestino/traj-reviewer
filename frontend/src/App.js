import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import Chat from './Chat';

const COMMAND_COLOR_PALETTE = [
  '#2ecc71', '#3498db', '#9b59b6', '#f39c12', '#e74c3c',
  '#1abc9c', '#34495e', '#27ae60', '#e84393', '#8e44ad'
];

const TOP_BASH_COMMANDS = [
  'ls', 'cd', 'pwd', 'cat', 'echo', 'touch', 'mkdir', 'rm', 'rmdir', 'cp',
  'mv', 'find', 'grep', 'sed', 'awk', 'head', 'tail', 'less', 'more', 'sort',
  'uniq', 'cut', 'paste', 'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'ssh', 'scp',
  'curl', 'wget', 'ping', 'traceroute', 'dig', 'host', 'nslookup', 'ifconfig', 'ip', 'netstat',
  'route', 'docker', 'docker-compose', 'kubectl', 'systemctl', 'service', 'ps', 'top', 'htop', 'kill',
  'pkill', 'killall', 'df', 'du', 'free', 'mount', 'umount', 'chmod', 'chown', 'chgrp',
  'ln', 'basename', 'dirname', 'tee', 'xargs', 'env', 'export', 'alias', 'unalias', 'history',
  'clear', 'sleep', 'time', 'yes', 'sudo', 'make', 'cmake', 'git', 'npm', 'yarn',
  'pnpm', 'node', 'npx', 'python', 'python3', 'pip', 'pip3', 'bundle', 'rails', 'rake',
  'go', 'cargo', 'rustc', 'java', 'javac', 'gradle', 'mvn', 'perl', 'php', 'composer'
];

const COMMAND_TAG_COLOR_MAP = TOP_BASH_COMMANDS.reduce((acc, command, index) => {
  acc[command] = COMMAND_COLOR_PALETTE[index % COMMAND_COLOR_PALETTE.length];
  return acc;
}, {
  bash: '#34495e',
  'str_replace_editor': '#ff6b6b',
  'str_replace_editor:create': '#ff922b',
  'str_replace_editor:view': '#ffa94d',
  'str_replace_editor:edit': '#f06595',
  'str_replace_editor:apply': '#e8590c',
  'str_replace_editor:preview': '#74c0fc'
});

const COMMAND_COLOR_DEFAULT = '#95a5a6';

const STATUS_OPTION_STYLES = {
  resolved: { backgroundColor: '#e6f4ea', color: '#1d6a2b' },
  unresolved: { backgroundColor: '#fdecea', color: '#8a1c1c' },
  unknown: { backgroundColor: '#eef2f7', color: '#54616d' },
};

const normalizeEscapedText = (input) => {
  if (typeof input !== 'string') {
    return '';
  }
  return input
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '    ')
    .replace(/\r/g, '\n');
};

function App() {
  const [trajectory, setTrajectory] = useState([]);
  const [history, setHistory] = useState([]);
  const [filteredTrajectory, setFilteredTrajectory] = useState([]);
  const [expandedSteps, setExpandedSteps] = useState([]);
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
  const [deliverables, setDeliverables] = useState([]);
  const [deliverablesLoading, setDeliverablesLoading] = useState(true);
  const [deliverablesError, setDeliverablesError] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('');
  const [selectedInstance, setSelectedInstance] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedRun, setSelectedRun] = useState('');
  const [selectedTrajectoryPath, setSelectedTrajectoryPath] = useState('');
  const [selectedTrajectoryMeta, setSelectedTrajectoryMeta] = useState(null);
  const [isLoadingDeliverable, setIsLoadingDeliverable] = useState(false);

  const fetchDeliverablesIndex = useCallback(async () => {
    try {
      setDeliverablesLoading(true);
      setDeliverablesError('');
      const response = await fetch('http://localhost:5001/deliverables/index');
      const data = await response.json();
      if (!response.ok || data.error) {
        const message = data?.error || `Failed to load deliverables (status ${response.status})`;
        throw new Error(message);
      }
      const trajectories = Array.isArray(data.trajectories) ? data.trajectories : [];
      setDeliverables(trajectories);
    } catch (error) {
      console.error('Failed to fetch deliverables index:', error);
      setDeliverables([]);
      setDeliverablesError(error.message || 'Failed to load deliverables index.');
    } finally {
      setDeliverablesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDeliverablesIndex();
  }, [fetchDeliverablesIndex]);

  const uniqueSorted = useCallback((items) => {
    return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
  }, []);

  const handleRefreshDeliverables = useCallback(() => {
    fetchDeliverablesIndex();
  }, [fetchDeliverablesIndex]);

  const { instanceStats, modelStats, runStats } = useMemo(() => {
    const instanceMap = new Map();
    const modelMap = new Map();
    const runMap = new Map();
    const seenRuns = new Set();

    deliverables.forEach(item => {
      const runKey = `${item.language}||${item.instance}||${item.model}||${item.run}`;
      if (seenRuns.has(runKey)) {
        return;
      }
      seenRuns.add(runKey);
      const resolvedState = typeof item.resolved === 'boolean' ? item.resolved : null;

      runMap.set(runKey, {
        language: item.language,
        instance: item.instance,
        model: item.model,
        run: item.run,
        resolved: resolvedState,
      });

      const instanceKey = `${item.language}||${item.instance}`;
      let instanceEntry = instanceMap.get(instanceKey);
      if (!instanceEntry) {
        instanceEntry = {
          language: item.language,
          instance: item.instance,
          totalRuns: 0,
          resolvedRuns: 0,
          unresolvedRuns: 0,
          unknownRuns: 0,
        };
        instanceMap.set(instanceKey, instanceEntry);
      }
      instanceEntry.totalRuns += 1;
      if (resolvedState === true) {
        instanceEntry.resolvedRuns += 1;
      } else if (resolvedState === false) {
        instanceEntry.unresolvedRuns += 1;
      } else {
        instanceEntry.unknownRuns += 1;
      }

      const modelKey = `${item.language}||${item.instance}||${item.model}`;
      let modelEntry = modelMap.get(modelKey);
      if (!modelEntry) {
        modelEntry = {
          language: item.language,
          instance: item.instance,
          model: item.model,
          totalRuns: 0,
          resolvedRuns: 0,
          unresolvedRuns: 0,
          unknownRuns: 0,
        };
        modelMap.set(modelKey, modelEntry);
      }
      modelEntry.totalRuns += 1;
      if (resolvedState === true) {
        modelEntry.resolvedRuns += 1;
      } else if (resolvedState === false) {
        modelEntry.unresolvedRuns += 1;
      } else {
        modelEntry.unknownRuns += 1;
      }
    });

    return {
      instanceStats: instanceMap,
      modelStats: modelMap,
      runStats: runMap,
    };
  }, [deliverables]);

  const determineAggregateStatus = useCallback((resolvedRuns, totalRuns, unknownRuns) => {
    if (resolvedRuns > 0) {
      return 'resolved';
    }
    if (totalRuns - unknownRuns > 0) {
      return 'unresolved';
    }
    return 'unknown';
  }, []);

  const formatResolutionSummary = useCallback((resolvedRuns, totalRuns, unknownRuns) => {
    let summary = `${resolvedRuns}/${totalRuns} resolved`;
    if (unknownRuns > 0) {
      summary += ` · ${unknownRuns} unknown`;
    }
    return summary;
  }, []);

  useEffect(() => {
    setSelectedInstance('');
    setSelectedModel('');
    setSelectedRun('');
    setSelectedTrajectoryPath('');
  }, [selectedLanguage]);

  useEffect(() => {
    setSelectedModel('');
    setSelectedRun('');
    setSelectedTrajectoryPath('');
  }, [selectedInstance]);

  useEffect(() => {
    setSelectedRun('');
    setSelectedTrajectoryPath('');
  }, [selectedModel]);

  const languageOptions = useMemo(() => {
    return uniqueSorted(deliverables.map(item => item.language));
  }, [deliverables, uniqueSorted]);

  const instanceOptions = useMemo(() => {
    const byInstance = new Map();
    instanceStats.forEach(value => {
      if (selectedLanguage && value.language !== selectedLanguage) {
        return;
      }
      const key = value.instance;
      const existing = byInstance.get(key);
      if (!existing) {
        byInstance.set(key, { ...value });
      } else {
        existing.totalRuns += value.totalRuns;
        existing.resolvedRuns += value.resolvedRuns;
        existing.unresolvedRuns += value.unresolvedRuns;
        existing.unknownRuns += value.unknownRuns;
      }
    });
    return Array.from(byInstance.values()).sort((a, b) =>
      a.instance.localeCompare(b.instance)
    );
  }, [instanceStats, selectedLanguage]);

  const modelOptions = useMemo(() => {
    const byModel = new Map();
    modelStats.forEach(value => {
      if (selectedLanguage && value.language !== selectedLanguage) {
        return;
      }
      if (selectedInstance && value.instance !== selectedInstance) {
        return;
      }
      const key = value.model;
      const existing = byModel.get(key);
      if (!existing) {
        byModel.set(key, { ...value });
      } else {
        existing.totalRuns += value.totalRuns;
        existing.resolvedRuns += value.resolvedRuns;
        existing.unresolvedRuns += value.unresolvedRuns;
        existing.unknownRuns += value.unknownRuns;
      }
    });
    return Array.from(byModel.values()).sort((a, b) =>
      a.model.localeCompare(b.model)
    );
  }, [modelStats, selectedLanguage, selectedInstance]);

  const runOptions = useMemo(() => {
    const byRun = new Map();
    runStats.forEach(value => {
      if (selectedLanguage && value.language !== selectedLanguage) {
        return;
      }
      if (selectedInstance && value.instance !== selectedInstance) {
        return;
      }
      if (selectedModel && value.model !== selectedModel) {
        return;
      }
      const existing = byRun.get(value.run);
      if (!existing) {
        byRun.set(value.run, {
          run: value.run,
          resolved: value.resolved ?? null,
        });
        return;
      }
      if (value.resolved === true) {
        existing.resolved = true;
      } else if (existing.resolved === null && typeof value.resolved === 'boolean') {
        existing.resolved = value.resolved;
      }
    });
    return Array.from(byRun.values()).sort((a, b) =>
      a.run.localeCompare(b.run, undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [runStats, selectedLanguage, selectedInstance, selectedModel]);

  const trajectoryOptions = useMemo(() => {
    return deliverables
      .filter(item => {
        if (selectedLanguage && item.language !== selectedLanguage) {
          return false;
        }
        if (selectedInstance && item.instance !== selectedInstance) {
          return false;
        }
        if (selectedModel && item.model !== selectedModel) {
          return false;
        }
        if (selectedRun && item.run !== selectedRun) {
          return false;
        }
        return true;
      })
      .map(item => ({
        label: item.file_name,
        value: item.relative_path,
        meta: item,
        resolved: typeof item.resolved === 'boolean' ? item.resolved : null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [deliverables, selectedLanguage, selectedInstance, selectedModel, selectedRun]);

  useEffect(() => {
    if (!trajectoryOptions.some(option => option.value === selectedTrajectoryPath)) {
      setSelectedTrajectoryPath('');
    }
    if (trajectoryOptions.length === 1 && !selectedTrajectoryPath) {
      setSelectedTrajectoryPath(trajectoryOptions[0].value);
    }
  }, [trajectoryOptions, selectedTrajectoryPath]);

  const selectedTrajectoryOption = useMemo(() => {
    return trajectoryOptions.find(option => option.value === selectedTrajectoryPath) || null;
  }, [trajectoryOptions, selectedTrajectoryPath]);

  const getStepText = (value, isStepZero = false) => {
    if (!value) return '';
    // Handle array format: [{"type": "text", "text": "..."}]
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null && 'text' in value[0]) {
        return value[0].text;
    }
    // Handle object format: {"text": "..."}
    if (typeof value === 'object' && value.text) return value.text;
    // Handle string format: "..."
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

    const visibleIndices = new Set(newFiltered.map(step => step.originalIndex));
    setExpandedSteps(prevExpanded =>
      prevExpanded.filter(index => visibleIndices.has(index))
    );
  }, [searchQuery, trajectory, semanticFilter]);

  const loadTrajectory = (contentString, clearModifiedContent = true) => {
    console.log('loadTrajectory called, clearModifiedContent:', clearModifiedContent);
    console.log('Content string length:', contentString?.length);
    console.log('Current modifiedContent before load:', modifiedContent);
    
    try {
      const data = JSON.parse(contentString);
      const hist = Array.isArray(data.history) ? data.history : [];

      // Persist canonical history in state for Chat
      setHistory(hist);

      let processedTrajectory = [];

      // Step 0 from history[1]
      if (hist.length > 1) {
        processedTrajectory.push({
          ...hist[1],
          originalIndex: 0,
          isStepZero: true,
        });
      }

      // Subsequent steps: pairs (assistant at even i, tool at i+1)
      // history[2] & history[3] => step 1, etc.
      let stepNumber = 1;
      for (let i = 2; i + 1 < hist.length; i += 2) {
        const assistant = typeof hist[i] === 'object' && hist[i] !== null ? hist[i] : {};
        const toolMsg = typeof hist[i + 1] === 'object' && hist[i + 1] !== null ? hist[i + 1] : {};

        const thought = getStepText(assistant.thought);
        const action = getStepText(assistant.action);
        let observation = getStepText(toolMsg.content);
        try {
          if (typeof observation === 'string' && observation.includes('OBSERVATION:\n')) {
            observation = observation.split('OBSERVATION:\n')[1];
          }
        } catch (_) {}

        processedTrajectory.push({
          thought,
          action,
          observation,
          originalIndex: stepNumber,
        });
        stepNumber += 1;
      }

      setTrajectory(processedTrajectory);
      const defaultExpanded = processedTrajectory
        .filter(step => step.isStepZero)
        .map(step => step.originalIndex);
      setExpandedSteps(defaultExpanded);
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

  const handleLoadSelectedTrajectory = useCallback(async () => {
    if (!selectedTrajectoryOption) {
      alert('Please choose a trajectory before loading.');
      return;
    }
    setIsLoadingDeliverable(true);
    try {
      const url = `http://localhost:5001/deliverables/trajectory?path=${encodeURIComponent(selectedTrajectoryOption.value)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!response.ok || data.error) {
        const message = data?.error || `Failed to load trajectory (status ${response.status})`;
        throw new Error(message);
      }
      const content = data.content;
      const displayName = data.file_name || selectedTrajectoryOption.meta.file_name;
      setFileName(displayName);
      setFileContent(content);
      setSelectedTrajectoryMeta(selectedTrajectoryOption.meta);
      setModifiedContent('');
      setSelectedTrajectoryPath(selectedTrajectoryOption.value);
      loadTrajectory(content);
    } catch (error) {
      console.error('Failed to load trajectory from deliverables:', error);
      alert(`Failed to load trajectory: ${error.message}`);
    } finally {
      setIsLoadingDeliverable(false);
    }
  }, [selectedTrajectoryOption, loadTrajectory]);

  const resetToSelection = useCallback(() => {
    setTrajectory([]);
    setHistory([]);
    setFilteredTrajectory([]);
    setExpandedSteps([]);
    setFileName('');
    setFileContent('');
    setModifiedContent('');
    setReplaceSearch('');
    setReplaceWith('');
    setEditingStep(null);
    setEditedThought('');
    setHasUnsavedChanges(false);
    setGeneratingThought(null);
    setSelectedTrajectoryMeta(null);
    setSearchQuery('');
    setSemanticFilter(null);
    setChatKey(key => key + 1);
  }, []);

  const handleReturnToSelection = useCallback(() => {
    if (hasUnsavedChanges) {
      const proceed = window.confirm('You have unsaved changes. Continue without saving?');
      if (!proceed) {
        return;
      }
    }
    resetToSelection();
  }, [hasUnsavedChanges, resetToSelection]);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setSelectedTrajectoryMeta(null);
      setSelectedTrajectoryPath('');
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const raw = e.target.result;
        setModifiedContent(''); // Clear any previous modifications
        try {
          const parsed = JSON.parse(raw);
          const hist = Array.isArray(parsed.history) ? parsed.history : [];
          const canonical = JSON.stringify({ history: hist }, null, 2);
          setFileContent(canonical);
          loadTrajectory(canonical);
        } catch (_) {
          // If not JSON, fallback (will likely error in loadTrajectory)
          setFileContent(raw);
          loadTrajectory(raw);
        }
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

  const ensureExpanded = (originalIndex) => {
    setExpandedSteps(prev => (prev.includes(originalIndex) ? prev : [...prev, originalIndex]));
  };

  const handleEditThought = (originalIndex) => {
    const step = filteredTrajectory.find(item => item.originalIndex === originalIndex);
    if (!step || step.isStepZero) {
      return;
    }
    ensureExpanded(originalIndex);
    setEditingStep(originalIndex);
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

  const handleGenerateThought = async (originalIndex) => {
    const currentStep = filteredTrajectory.find(step => step.originalIndex === originalIndex);
    if (!currentStep || currentStep.isStepZero) {
      return;
    }

    ensureExpanded(originalIndex);
    setGeneratingThought(originalIndex);

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

  const handleRemoveStep = async (originalIndex) => {
    const step = filteredTrajectory.find(item => item.originalIndex === originalIndex);
    if (!step) return;
    if (step.isStepZero || step.originalIndex === 0) {
      alert('Cannot remove Step 0.');
      return;
    }

    if (!window.confirm(`Remove step ${step.originalIndex}? This cannot be undone.`)) {
      return;
    }

    try {
      console.log('handleRemoveStep called');
      const contentToUpdate = modifiedContent || fileContent;
      const response = await fetch('http://localhost:5001/remove_step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: contentToUpdate,
          original_index: step.originalIndex,
        }),
      });

      const data = await response.json();
      console.log('remove_step response:', data);

      if (data.error) {
        throw new Error(data.error);
      }

      setModifiedContent(data.modified_content);
      loadTrajectory(data.modified_content, false);
      setHasUnsavedChanges(true);
      setExpandedSteps(prev => prev.filter(index => index !== originalIndex));

      alert(`Removed step ${step.originalIndex} successfully.`);
    } catch (error) {
      console.error('Error removing step:', error);
      alert(`Failed to remove step: ${error.message}`);
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSemanticFilter(null);
    // The useEffect will handle position restoration automatically
  };

  const handleSemanticFilter = (filteredSteps) => {
    setSemanticFilter(filteredSteps);
  };

  const hasLoadedTrajectory = trajectory.length > 0;
  const selectedDeliverableSummary = selectedTrajectoryMeta
    ? `${selectedTrajectoryMeta.language} · ${selectedTrajectoryMeta.instance} · ${selectedTrajectoryMeta.model} · ${selectedTrajectoryMeta.run}`
    : null;
  const selectedDeliverableResolvedValue = selectedTrajectoryMeta?.resolved;
  const selectedDeliverableStatus = selectedTrajectoryMeta
    ? selectedDeliverableResolvedValue === true
      ? 'resolved'
      : selectedDeliverableResolvedValue === false
      ? 'unresolved'
      : 'unknown'
    : null;
  const selectedDeliverableStatusLabel =
    selectedDeliverableStatus === 'resolved'
      ? 'Resolved'
      : selectedDeliverableStatus === 'unresolved'
      ? 'Unresolved'
      : selectedDeliverableStatus === 'unknown'
      ? 'Unknown'
      : null;

  const renderSelectionScreen = () => {
    const languageDisabled = deliverablesLoading || languageOptions.length === 0;
    const instanceDisabled = deliverablesLoading || !selectedLanguage || instanceOptions.length === 0;
    const modelDisabled = deliverablesLoading || !selectedInstance || modelOptions.length === 0;
    const runDisabled = deliverablesLoading || !selectedModel || runOptions.length === 0;
    const trajectoryDisabled = deliverablesLoading || !selectedRun || trajectoryOptions.length === 0;

    return (
      <div className="App selection-mode">
        <div className="selection-wrapper">
          <header className="selection-header">
            <h1>Trajectory Viewer</h1>
            <p>Select a deliverable trajectory or upload a JSON/.traj file to begin.</p>
          </header>
          <main className="selection-main">
            <section className="selection-card">
              <div className="selection-card-heading">
                <h2>Browse Deliverables</h2>
                <button
                  type="button"
                  className="refresh-button"
                  onClick={handleRefreshDeliverables}
                  disabled={deliverablesLoading}
                >
                  {deliverablesLoading ? 'Refreshing…' : 'Refresh list'}
                </button>
              </div>
              {deliverablesError && (
                <div className="error-banner">
                  {deliverablesError}
                </div>
              )}
              {deliverablesLoading && !deliverablesError ? (
                <p className="helper-text">Loading deliverables…</p>
              ) : deliverables.length === 0 ? (
                <p className="helper-text">No trajectories found in the deliverables folder.</p>
              ) : (
                <>
                  <div className="selection-grid">
                    <label>
                      <span>Language</span>
                      <select
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                        disabled={languageDisabled}
                      >
                        <option value="">Select language</option>
                        {languageOptions.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Instance</span>
                      <select
                        value={selectedInstance}
                        onChange={(e) => setSelectedInstance(e.target.value)}
                        disabled={instanceDisabled}
                      >
                        <option value="">Select instance</option>
                        {instanceOptions.map(option => {
                          const status = determineAggregateStatus(
                            option.resolvedRuns,
                            option.totalRuns,
                            option.unknownRuns
                          );
                          const label = `${option.instance} (${formatResolutionSummary(
                            option.resolvedRuns,
                            option.totalRuns,
                            option.unknownRuns
                          )})`;
                          const style = STATUS_OPTION_STYLES[status] || undefined;
                          return (
                            <option key={option.instance} value={option.instance} style={style}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      <span>Model</span>
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        disabled={modelDisabled}
                      >
                        <option value="">Select model</option>
                        {modelOptions.map(option => {
                          const status = determineAggregateStatus(
                            option.resolvedRuns,
                            option.totalRuns,
                            option.unknownRuns
                          );
                          const label = `${option.model} (${formatResolutionSummary(
                            option.resolvedRuns,
                            option.totalRuns,
                            option.unknownRuns
                          )})`;
                          const style = STATUS_OPTION_STYLES[status] || undefined;
                          return (
                            <option key={option.model} value={option.model} style={style}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      <span>Run</span>
                      <select
                        value={selectedRun}
                        onChange={(e) => {
                          setSelectedRun(e.target.value);
                          setSelectedTrajectoryPath('');
                        }}
                        disabled={runDisabled}
                      >
                        <option value="">Select run</option>
                        {runOptions.map(option => {
                          const resolved = option.resolved;
                          const label =
                            resolved === true
                              ? `${option.run} (resolved)`
                              : resolved === false
                              ? `${option.run} (unresolved)`
                              : `${option.run} (unknown)`;
                          const status =
                            resolved === true
                              ? 'resolved'
                              : resolved === false
                              ? 'unresolved'
                              : 'unknown';
                          const style = STATUS_OPTION_STYLES[status] || undefined;
                          return (
                            <option key={option.run} value={option.run} style={style}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <label>
                      <span>Trajectory</span>
                      <select
                        value={selectedTrajectoryPath}
                        onChange={(e) => setSelectedTrajectoryPath(e.target.value)}
                        disabled={trajectoryDisabled}
                      >
                        <option value="">Select trajectory file</option>
                        {trajectoryOptions.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {selectedTrajectoryOption && (
                    <div
                      className={`selection-summary ${
                        selectedTrajectoryOption.resolved === true
                          ? 'resolved'
                          : selectedTrajectoryOption.resolved === false
                          ? 'unresolved'
                          : 'unknown'
                      }`}
                    >
                      <span className="summary-heading">Selected:</span>
                      <span className="summary-details">
                        {`${selectedTrajectoryOption.meta.language} · ${selectedTrajectoryOption.meta.instance} · ${selectedTrajectoryOption.meta.model} · ${selectedTrajectoryOption.meta.run}`}
                      </span>
                      <span className="summary-path">{selectedTrajectoryOption.meta.relative_path}</span>
                      <span
                        className={`status-badge ${
                          selectedTrajectoryOption.resolved === true
                            ? 'resolved'
                            : selectedTrajectoryOption.resolved === false
                            ? 'unresolved'
                            : 'unknown'
                        }`}
                      >
                        {selectedTrajectoryOption.resolved === true
                          ? 'Resolved'
                          : selectedTrajectoryOption.resolved === false
                          ? 'Unresolved'
                          : 'Unknown'}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="selection-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleLoadSelectedTrajectory}
                  disabled={!selectedTrajectoryOption || isLoadingDeliverable}
                >
                  {isLoadingDeliverable ? 'Loading…' : 'Load trajectory'}
                </button>
              </div>
            </section>
            <section className="selection-card secondary">
              <h2>Upload a File</h2>
              <p className="helper-text">Upload a `.json` or `.traj` file exported from an agent run.</p>
              <div className="file-upload-container initial-upload">
                <input
                  type="file"
                  id="initial-file-upload"
                  onChange={handleFileUpload}
                  accept=".json,.traj"
                />
                <label htmlFor="initial-file-upload" className="file-upload-button">
                  Upload Trajectory
                </label>
              </div>
            </section>
          </main>
        </div>
      </div>
    );
  };

  const toPlainText = (value, isStepZero = false) => getStepText(value, isStepZero) || '';

  const highlightText = (stringText) => {
    if (typeof stringText !== 'string' || stringText.length === 0) {
      return stringText;
    }
    const searchTerms = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) {
      return stringText;
    }
    const escapedTerms = searchTerms.map(term => escapeRegExp(term));
    const regex = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
    return stringText.split(regex).map((part, index) => {
      if (searchTerms.includes(part.toLowerCase())) {
        return <mark key={`highlight-${index}`}>{part}</mark>;
      }
      return part;
    });
  };

  const createHighlightedFragment = (text, key) => {
    if (!text) {
      return null;
    }
    return <React.Fragment key={key}>{highlightText(text)}</React.Fragment>;
  };

  const renderSummaryText = (value, { isStepZero = false, firstLineOnly = false } = {}) => {
    const raw = toPlainText(value, isStepZero).trim();
    if (!raw) {
      return <span className="empty-text">—</span>;
    }
    let display = raw;
    if (firstLineOnly) {
      const lines = raw.split(/\r?\n/);
      const nonEmpty = lines.find(line => line.trim().length > 0);
      display = (nonEmpty !== undefined ? nonEmpty : lines[0] || raw).trim();
    }
    if (display.length > 180) {
      display = `${display.slice(0, 180).trimEnd()}…`;
    }
    return highlightText(display);
  };

  const renderStepZeroContent = (text) => {
    if (!text || !text.trim()) {
      return <span className="empty-text">—</span>;
    }

    const tagRegex = /<([a-zA-Z0-9_\-:]+)>([\s\S]*?)<\/\1>/g;
    const segments = [];
    let lastIndex = 0;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'tag', tag: match[1], content: match[2] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      segments.push({ type: 'text', content: text.slice(lastIndex) });
    }

    const normalizeTitle = (rawTag) => {
      const map = {
        pr_description: 'PR Description',
        uploaded_files: 'Uploaded Files',
        additional_notes: 'Additional Notes'
      };
      if (map[rawTag]) {
        return map[rawTag];
      }
      return rawTag
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
    };

  const renderParagraphGroup = (rawContent, keyPrefix) => {
    const normalizedContent = normalizeEscapedText(rawContent || '').trim();
    if (!normalizedContent) {
      return [];
    }
    const blocks = normalizedContent.split(/\n{2,}/);
    const parts = [];
    blocks.forEach((block, blockIndex) => {
      const trimmedBlock = block.trim();
      if (!trimmedBlock) {
        return;
      }

      if (/^#{1,6}\s+/.test(trimmedBlock)) {
          const heading = trimmedBlock.replace(/^#{1,6}\s+/, '').trim();
          if (heading) {
            parts.push(
              <h3 key={`${keyPrefix}-heading-${blockIndex}`}>{highlightText(heading)}</h3>
            );
          }
          return;
        }

        const lines = trimmedBlock
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          return;
        }

        if (lines.every(line => /^[-*]\s+/.test(line))) {
          const bullets = lines
            .map(line => line.replace(/^[-*]\s+/, '').trim())
            .filter(Boolean)
            .map((item, itemIndex) => (
              <li key={`${keyPrefix}-bullet-${blockIndex}-${itemIndex}`}>
                {highlightText(item)}
              </li>
            ));
          if (bullets.length > 0) {
            parts.push(<ul key={`${keyPrefix}-list-${blockIndex}`}>{bullets}</ul>);
          }
          return;
        }

        if (lines.every(line => /^\d+\.\s+/.test(line))) {
          const ordered = lines
            .map(line => line.replace(/^\d+\.\s+/, '').trim())
            .filter(Boolean)
            .map((item, itemIndex) => (
              <li key={`${keyPrefix}-ordered-${blockIndex}-${itemIndex}`}>
                {highlightText(item)}
              </li>
            ));
          if (ordered.length > 0) {
            parts.push(<ol key={`${keyPrefix}-ordered-${blockIndex}`}>{ordered}</ol>);
          }
          return;
        }

        const paragraphText = lines.join(' ').trim();
        if (paragraphText) {
          parts.push(
            <p key={`${keyPrefix}-paragraph-${blockIndex}`}>{highlightText(paragraphText)}</p>
          );
        }
      });
      return parts;
    };

    const renderMessageThread = (messages, keyPrefix) => {
      return (
        <div className="instructions-thread" key={`thread-${keyPrefix}`}>
          {messages.map((message, messageIndex) => {
            const author = message.author || message.role || 'Message';
            const timestampRaw = message.timestamp;
            let timestampLabel = null;
            if (timestampRaw) {
              try {
                const ts = new Date(timestampRaw);
                if (!Number.isNaN(ts.getTime())) {
                  timestampLabel = ts.toLocaleString();
                }
              } catch (_) {
                timestampLabel = timestampRaw;
              }
            }
            let bodyText = '';
            if (typeof message.content === 'string') {
              bodyText = message.content;
            } else if (Array.isArray(message.content)) {
              bodyText = message.content.map(String).join('\n');
            } else if (message.content) {
              try {
                bodyText = JSON.stringify(message.content, null, 2);
              } catch (_) {
                bodyText = String(message.content);
              }
            }
            bodyText = normalizeEscapedText(bodyText || '');
            const bodyNodes = renderParagraphGroup(bodyText, `${keyPrefix}-msg-${messageIndex}`);
            return (
              <div className="instructions-message" key={`thread-${keyPrefix}-msg-${messageIndex}`}>
                <div className="instructions-message-meta">
                  <span className="instructions-message-author">{highlightText(author)}</span>
                  {timestampLabel && (
                    <span className="instructions-message-timestamp">{timestampLabel}</span>
                  )}
                </div>
                <div className="instructions-message-body">
                  {bodyNodes.length > 0 ? bodyNodes : <p>{highlightText('')}</p>}
                </div>
              </div>
            );
          })}
        </div>
      );
    };

    const elements = [];
    segments.forEach((segment, index) => {
      const content = segment.content ? segment.content.trim() : '';
      if (!content) {
        return;
      }

      if (segment.type === 'tag') {
        const title = normalizeTitle(segment.tag);
        let renderedBlock = null;
        const trimmed = content.trim();
        if (/^[\[{]/.test(trimmed)) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.every(entry => typeof entry === 'object')) {
              renderedBlock = renderMessageThread(parsed, `tag-${index}`);
            }
          } catch (_) {
            // fall back to paragraph handling
          }
        }
        const paragraphs = renderedBlock ? [] : renderParagraphGroup(content, `tag-${index}`);
        if (renderedBlock || paragraphs.length > 0) {
          elements.push(
            <div className="instructions-section" key={`section-${index}`}>
              <h3>{highlightText(title)}</h3>
              {renderedBlock || paragraphs}
            </div>
          );
        }
        return;
      }

      const paragraphs = renderParagraphGroup(content, `text-${index}`);
      if (paragraphs.length > 0) {
        elements.push(
          <div className="instructions-section" key={`text-${index}`}>
            {paragraphs}
          </div>
        );
      }
    });

    if (elements.length === 0) {
      return <p>{highlightText(text.trim())}</p>;
    }

    return <div className="instructions-content">{elements}</div>;
  };

  const extractCodeFence = (text) => {
    const trimmed = text.trim();
    const fenceMatch = trimmed.match(/^```(\w+)?\s*\n([\s\S]*?)\n?```$/);
    if (!fenceMatch) {
      return null;
    }
    return {
      language: fenceMatch[1] ? fenceMatch[1].toLowerCase() : null,
      code: fenceMatch[2],
    };
  };

  const parseJsonSafely = (text) => {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return null;
    } catch (_) {
      return null;
    }
  };

  const shouldTreatAsCode = (text, languageHint) => {
    if (!text) {
      return false;
    }
    if (languageHint) {
      return true;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }
    if (parseJsonSafely(trimmed)) {
      return true;
    }
    if (trimmed.includes('\n')) {
      if (/\b(const|let|var|function|return|if|else|for|while|class|import|def|lambda|async|await|try|except|catch|SELECT|INSERT|UPDATE|DELETE|BEGIN|END)\b/i.test(trimmed)) {
        return true;
      }
      if (/[{;}]/.test(trimmed)) {
        return true;
      }
    }
    return false;
  };

  const syntaxHighlightJson = (jsonString) => {
    const tokenRegex = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    const nodes = [];
    let lastIndex = 0;
    let tokenId = 0;

    jsonString.replace(tokenRegex, (match, _group, offset) => {
      if (offset > lastIndex) {
        const plainSegment = jsonString.slice(lastIndex, offset);
        const fragment = createHighlightedFragment(plainSegment, `json-plain-${tokenId++}`);
        if (fragment) {
          nodes.push(fragment);
        }
      }

      let className = 'number';
      if (match.startsWith('"')) {
        className = match.endsWith(':') ? 'key' : 'string';
      } else if (/true|false/i.test(match)) {
        className = 'boolean';
      } else if (/null/i.test(match)) {
        className = 'null';
      }

      nodes.push(
        <span className={`code-token ${className}`} key={`json-token-${tokenId++}`}>
          {highlightText(match)}
        </span>
      );

      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < jsonString.length) {
      const trailing = jsonString.slice(lastIndex);
      const fragment = createHighlightedFragment(trailing, `json-tail-${lastIndex}`);
      if (fragment) {
        nodes.push(fragment);
      }
    }

    if (nodes.length === 0) {
      return [createHighlightedFragment(jsonString, 'json-fallback')];
    }

    return nodes;
  };

  const syntaxHighlightGeneric = (codeString) => {
    const keywords = [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'break', 'continue',
      'class', 'extends', 'import', 'from', 'export', 'async', 'await', 'try', 'catch', 'finally',
      'def', 'lambda', 'yield', 'with', 'pass', 'raise', 'True', 'False', 'None'
    ];
    const keywordPattern = keywords.join('|');
    const tokenRegex = new RegExp(`(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|\\\`(?:\\\\.|[^\\\`])*\\\`|\\b(?:${keywordPattern})\\b|\\b\\d+(?:\\.\\d+)?\\b)`, 'g');
    const nodes = [];
    let lastIndex = 0;
    let tokenId = 0;

    codeString.replace(tokenRegex, (match, _group, offset) => {
      if (offset > lastIndex) {
        const plainSegment = codeString.slice(lastIndex, offset);
        const fragment = createHighlightedFragment(plainSegment, `code-plain-${tokenId++}`);
        if (fragment) {
          nodes.push(fragment);
        }
      }

      let className = 'keyword';
      if (/^["'`]/.test(match)) {
        className = 'string';
      } else if (/^\d/.test(match)) {
        className = 'number';
      }

      nodes.push(
        <span className={`code-token ${className}`} key={`code-token-${tokenId++}`}>
          {highlightText(match)}
        </span>
      );

      lastIndex = offset + match.length;
      return match;
    });

    if (lastIndex < codeString.length) {
      const trailing = codeString.slice(lastIndex);
      const fragment = createHighlightedFragment(trailing, `code-tail-${lastIndex}`);
      if (fragment) {
        nodes.push(fragment);
      }
    }

    if (nodes.length === 0) {
      return [createHighlightedFragment(codeString, 'code-fallback')];
    }

    return nodes;
  };

  const renderCodeBlock = (codeBody, languageHint = null) => {
    const normalized = codeBody.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    const trimmed = normalized.trim();
    const jsonValue = parseJsonSafely(trimmed);

    let languageClass = languageHint;
    let contentNodes;

    if (jsonValue) {
      const pretty = JSON.stringify(jsonValue, null, 2);
      contentNodes = syntaxHighlightJson(pretty);
      languageClass = languageClass || 'json';
    } else {
      contentNodes = syntaxHighlightGeneric(normalized);
    }

    return (
      <pre className={`code-block ${languageClass ? `code-${languageClass}` : ''}`}>
        <code>{contentNodes}</code>
      </pre>
    );
  };

  const renderDetailContent = (value, { isStepZero = false, allowCodeFormat = true } = {}) => {
    const raw = toPlainText(value, isStepZero);
    if (!raw || raw.trim().length === 0) {
      return <span className="empty-text">—</span>;
    }

    if (isStepZero) {
      return renderStepZeroContent(raw);
    }

    const fence = extractCodeFence(raw);
    const codeBody = fence ? fence.code : raw;
    const languageHint = fence ? fence.language : null;

    if (allowCodeFormat && shouldTreatAsCode(codeBody, languageHint)) {
      return renderCodeBlock(codeBody, languageHint);
    }

    return <p>{highlightText(raw)}</p>;
  };

  const splitCommandSegments = (commandText) => {
    if (typeof commandText !== 'string') {
      return [];
    }

    const segments = [];
    let current = '';
    let quoteChar = null;

    const pushCurrent = () => {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        segments.push(trimmed);
      }
      current = '';
    };

    for (let i = 0; i < commandText.length; i += 1) {
      const char = commandText[i];
      const next = commandText[i + 1];
      const prev = commandText[i - 1];

      if (quoteChar) {
        current += char;
        if (char === quoteChar && prev !== '\\') {
          quoteChar = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === '`') {
        quoteChar = char;
        current += char;
        continue;
      }

      // Handle double-character separators
      if (char === '&' && next === '&') {
        pushCurrent();
        i += 1;
        continue;
      }
      if (char === '|' && next === '|') {
        pushCurrent();
        i += 1;
        continue;
      }

      // Handle single-character separators when not quoted
      if (char === ';' || char === '\n' || char === '\r' || char === '\u2028' || char === '\u2029') {
        pushCurrent();
        continue;
      }

      if (char === '|') {
        pushCurrent();
        continue;
      }

      current += char;
    }

    if (current.length > 0) {
      pushCurrent();
    }

    return segments;
  };

  const extractPrimaryLine = (text) => {
    if (!text) {
      return '';
    }
    const [firstLine] = text.split(/\r?\n/);
    return firstLine ? firstLine.trim() : '';
  };

  const sanitizeCommandName = (token) => {
    if (!token) {
      return '';
    }
    let cleaned = token
      .replace(/^[^A-Za-z0-9._-]+/, '')
      .replace(/[^A-Za-z0-9._-]+$/, '');
    // Remove surrounding quotes if still present after initial cleanup
    cleaned = cleaned.replace(/^["'`]+/, '').replace(/["'`]+$/, '');
    return cleaned;
  };

  const normalizeCommandToken = (segment, collector) => {
    if (!segment) return;
    const loweredSegment = segment.toLowerCase();

    if (loweredSegment.includes('str_replace_editor')) {
      const modeCandidates = [
        loweredSegment.match(/str_replace_editor\s*(?::|=)\s*([a-z0-9_-]+)/),
        loweredSegment.match(/str_replace_editor\s+([a-z0-9_-]+)/),
        loweredSegment.match(/["']action["']\s*[:=]\s*["']([a-z0-9_-]+)["']/),
        loweredSegment.match(/['"]mode['"]\s*[:=]\s*['"]([a-z0-9_-]+)['"]/),
        loweredSegment.match(/["']operation["']\s*[:=]\s*["']([a-z0-9_-]+)["']/)
      ];

      const modeMatch = modeCandidates.find(Boolean);
      const mode = modeMatch ? modeMatch[1] : null;
      collector.add(mode ? `str_replace_editor:${mode}` : 'str_replace_editor');
      return;
    }

    const tokens = segment.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;

    // Remove leading environment variable assignments
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
    }

    if (tokens.length === 0) return;

    let primary = sanitizeCommandName(tokens[0]).toLowerCase();
    if (!primary) return;

    if (primary === 'sudo' && tokens.length > 1) {
      collector.add('sudo');
      primary = sanitizeCommandName(tokens[1]).toLowerCase();
    }

    if (primary) {
      collector.add(primary);
    }
  };

  const getTagColor = (tag) => {
    if (COMMAND_TAG_COLOR_MAP[tag]) {
      return COMMAND_TAG_COLOR_MAP[tag];
    }
    if (tag.startsWith('str_replace_editor:')) {
      return COMMAND_TAG_COLOR_MAP['str_replace_editor'] || COMMAND_COLOR_DEFAULT;
    }
    return COMMAND_COLOR_DEFAULT;
  };

  const getActionTags = (step) => {
    if (!step || step.isStepZero) {
      return [];
    }

    const rawActionFull = toPlainText(step.action);
    if (!rawActionFull) {
      return [];
    }

    const rawAction = extractPrimaryLine(rawActionFull);

    const tagCollector = new Set();
    const textCandidates = new Set([rawAction]);

    const keyValueQuotedRegex = /(command|cmd|commands|script|code|input|tool_input|toolInput|source|shell)\s*[:=]\s*["'`]{1}([^"'`]+)["'`]/gi;
    let match;
    while ((match = keyValueQuotedRegex.exec(rawAction)) !== null) {
      textCandidates.add(match[2]);
    }

    const keyValueBareRegex = /(command|cmd|commands|script|code|input|tool_input|toolInput|source|shell)\s*[:=]\s*([^\s,]+)/gi;
    while ((match = keyValueBareRegex.exec(rawAction)) !== null) {
      textCandidates.add(match[2]);
    }

    textCandidates.forEach(text => {
      splitCommandSegments(text).forEach(segment => {
        normalizeCommandToken(segment, tagCollector);
      });
    });

    return Array.from(tagCollector);
  };

  const isStepExpanded = (originalIndex) => expandedSteps.includes(originalIndex);

  const toggleStepExpansion = (originalIndex) => {
    setExpandedSteps(prev =>
      prev.includes(originalIndex)
        ? prev.filter(index => index !== originalIndex)
        : [...prev, originalIndex]
    );
  };

  const visibleIndices = filteredTrajectory.map(step => step.originalIndex);
  const allExpanded = visibleIndices.length > 0 && visibleIndices.every(index => expandedSteps.includes(index));

  const handleToggleAll = () => {
    if (visibleIndices.length === 0) {
      return;
    }
    if (allExpanded) {
      setExpandedSteps([]);
    } else {
      setExpandedSteps(visibleIndices);
    }
  };

  if (!hasLoadedTrajectory) {
    return renderSelectionScreen();
  }

  return (
    <div className="App">
      <div className="main-layout">
        <div className="trajectory-viewer-container">
          <header className="App-header">
            <h1>Trajectory Viewer</h1>
            <div className="controls-container">
              <div className="file-upload-container">
                <input type="file" id="file-upload" onChange={handleFileUpload} accept=".json,.traj" />
                <label htmlFor="file-upload" className="file-upload-button">
                  Upload File
                </label>
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
            <div
              className={`active-selection-bar ${
                selectedDeliverableStatus ? selectedDeliverableStatus : ''
              }`}
            >
              <div className="active-selection-text">
                {selectedDeliverableSummary ? (
                  <>
                    <span className="selection-label">Deliverable:</span>
                    <span className="selection-value">{selectedDeliverableSummary}</span>
                    <span className="selection-path">{selectedTrajectoryMeta?.relative_path}</span>
                  </>
                ) : (
                  <>
                    <span className="selection-label">Uploaded file:</span>
                    <span className="selection-value">{fileName || 'Custom trajectory'}</span>
                  </>
                )}
              </div>
              <div className="active-selection-actions">
                {selectedDeliverableStatusLabel && (
                  <span
                    className={`status-badge ${
                      selectedDeliverableStatus ? selectedDeliverableStatus : ''
                    }`}
                  >
                    {selectedDeliverableStatusLabel}
                  </span>
                )}
                <button
                  type="button"
                  className="change-selection-button"
                  onClick={handleReturnToSelection}
                >
                  Choose another trajectory
                </button>
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
            {filteredTrajectory.length > 0 ? (
              <>
                <div className="trajectory-toolbar">
                  <div className="trajectory-count">
                    Showing {filteredTrajectory.length} of {trajectory.length} entries
                    {(searchQuery.trim() || semanticFilter) && (
                      <span className="filtered-count">
                        {' '}· filtered view
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleAll}
                    className="toggle-all-button"
                    disabled={filteredTrajectory.length === 0}
                  >
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>
                <div className="trajectory-list">
                  {filteredTrajectory.map((step, index) => {
                    const expanded = isStepExpanded(step.originalIndex);
                    const isEditing = editingStep === step.originalIndex;
                    const actionTags = getActionTags(step);

                    return (
                      <div
                        key={step.originalIndex}
                        className={`trajectory-card ${expanded ? 'expanded' : 'collapsed'} ${step.isStepZero ? 'user-instructions-card' : ''}`}
                      >
                        <div className="card-header">
                          <button
                            type="button"
                            className="toggle-step-button"
                            onClick={() => toggleStepExpansion(step.originalIndex)}
                          >
                            {expanded ? 'Collapse' : 'Expand'}
                          </button>
                          <div className="card-header-text">
                            <h2>
                              {step.isStepZero ? 'User Instructions (Step 0)' : `Step ${step.originalIndex}`}
                            </h2>
                            {(searchQuery.trim() || semanticFilter) && (
                              <span className="match-index">
                                Match {index + 1} of {filteredTrajectory.length}
                              </span>
                            )}
                          </div>
                        </div>
                        {actionTags.length > 0 && (
                          <div className="command-tags">
                            {actionTags.map(tag => (
                              <span
                                key={`${step.originalIndex}-${tag}`}
                                className="command-tag"
                                style={{ backgroundColor: getTagColor(tag) }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="card-summary">
                          {step.isStepZero ? (
                            !expanded && (
                              <div className="summary-row instructions-summary">
                                <span className="summary-label">Instructions:</span>
                                <span className="summary-content instructions-snippet">
                                  {renderSummaryText(step.content, { isStepZero: true, firstLineOnly: true })}
                                </span>
                              </div>
                            )
                          ) : (
                            <>
                              <div className="summary-row">
                                <span className="summary-label">Thought:</span>
                                <span className="summary-content">
                                  {renderSummaryText(step.thought, { firstLineOnly: true })}
                                </span>
                              </div>
                              <div className="summary-row">
                                <span className="summary-label">Action:</span>
                                <span className="summary-content">
                                  {renderSummaryText(step.action, { firstLineOnly: true })}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                        {expanded && (
                          <div className="card-details">
                            {step.isStepZero ? (
                              <div className="detail-block">
                                {renderDetailContent(step.content, { isStepZero: true, allowCodeFormat: false })}
                              </div>
                            ) : (
                              <>
                                {step.reasoning && (
                                  <div className="detail-block reasoning">
                                    <h3>Reasoning</h3>
                                    <p>{step.reasoning}</p>
                                  </div>
                                )}
                                <div className="detail-block">
                                  <div className="detail-header">
                                    <h3>Thought</h3>
                                    {isEditing ? (
                                      <div className="detail-actions">
                                        <button onClick={handleSaveThought} className="save-edit-btn">Save</button>
                                        <button onClick={handleCancelEdit} className="cancel-edit-btn">Cancel</button>
                                      </div>
                                    ) : (
                                      <div className="detail-actions">
                                        <button onClick={() => handleEditThought(step.originalIndex)} className="edit-btn">Edit</button>
                                        <button
                                          onClick={() => handleGenerateThought(step.originalIndex)}
                                          className="generate-edit-btn"
                                          disabled={generatingThought === step.originalIndex}
                                        >
                                          {generatingThought === step.originalIndex ? 'Generating...' : 'Generate with AI'}
                                        </button>
                                        <button
                                          onClick={() => handleRemoveStep(step.originalIndex)}
                                          className="remove-edit-btn"
                                          disabled={step.originalIndex === 0}
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {isEditing ? (
                                    <textarea
                                      value={editedThought}
                                      onChange={(e) => setEditedThought(e.target.value)}
                                      className="thought-editor"
                                      rows={6}
                                    />
                                  ) : (
                                    renderDetailContent(step.thought, { allowCodeFormat: false })
                                  )}
                                </div>
                                <div className="detail-block">
                                  <h3>Action</h3>
                                  {renderDetailContent(step.action)}
                                </div>
                                <div className="detail-block">
                                  <h3>Observation</h3>
                                  {renderDetailContent(step.observation)}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
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
          <Chat key={chatKey} history={history} onFilter={handleSemanticFilter} />
        </div>
      </div>
    </div>
  );
}

export default App;
