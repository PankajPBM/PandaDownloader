import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('Panda UI Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 30, color: '#f8fafc', background: '#070a12', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🐼</div>
          <h2 style={{ fontSize: 18, marginBottom: 8, color: '#f43f5e' }}>Panda Downloader UI Recovery</h2>
          <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 450, textAlign: 'center', marginBottom: 20 }}>
            {String(this.state.error?.message || 'An unexpected interface error occurred.')}
          </p>
          <button 
            onClick={() => window.location.reload()} 
            style={{ padding: '8px 20px', background: '#10b981', color: '#070a12', border: 'none', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}
          >
            Reload Interface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
