# Trajectory Reviewer

A web-based application for reviewing and analyzing SWE-bench agentic trajectories with AI-powered assistance. This tool allows you to visualize, filter, search, and modify trajectory data with an integrated o3 chat interface for intelligent analysis.

## Features

- **Trajectory Visualization**: View agent steps with thought, action, and observation data
- **Step Navigation**: Navigate forward and backward through trajectory steps
- **Keyword & AI Filtering**: Real-time search and semantic filtering with o3
- **Chat Integration**: Built-in AI assistant for trajectory analysis and patch leakage detection
- **Search & Replace**: Global find/replace with regex support and file saving

## Setup

### Prerequisites
- Node.js (v14+)
- Python 3.9+
- OpenAI API key

### Backend Setup

1. **Navigate to backend and create virtual environment:**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Create `.env` file:**
   ```
   OPENAI_API_KEY="your_openai_api_key_here"
   ```

3. **Start backend:**
   ```bash
   python app.py
   ```

### Frontend Setup

1. **Navigate to frontend and install dependencies:**
   ```bash
   cd frontend
   npm install
   npm start
   ```

## Usage

### File Format
Upload JSON files with this structure:
```json
{
  "history": [
    {...},
    {"content": [{"text": "User instructions..."}]}
  ],
  "trajectory": [
    {
      "thought": "Agent's reasoning...",
      "action": "Action taken...",
      "observation": "Result observed..."
    }
  ]
}
```

### Key Features

- **Navigation**: Use Previous/Next buttons, Step 0 shows user instructions
- **Keyword Search**: Enter terms in the filter box, results are highlighted
- **AI Chat**: Ask questions or request semantic filters (e.g., "Filter for file operations")
- **Search & Replace**: Find/replace text globally, save modified files
- **Clear Filters**: Reset all active filters with one click

## API Endpoints

- `POST /chat` - AI chat interface
- `POST /replace` - Global search and replace
- `POST /save` - Save modified trajectory

## Development

- **Backend**: Flask server in `backend/app.py`
- **Frontend**: React app in `frontend/src/`
- **Model**: Currently uses `o3` 