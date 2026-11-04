import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Fanger feil under visning, så brukeren får en rolig side i stedet for en hvit. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Feil under visning', error, info.componentStack);
  }

  private reload = () => {
    // replace i stedet for reload: da følger ikke historikk-tilstanden med, om den var årsaken.
    window.location.replace(window.location.pathname + window.location.search);
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="state state--center" role="alert">
        <div className="state__ornament" aria-hidden="true">
          ❦
        </div>
        <h1>Noe gikk galt</h1>
        <p className="dim">Siden kunne ikke vises. Prøv å laste den inn på nytt.</p>
        <button type="button" className="btn" onClick={this.reload}>
          Last inn på nytt
        </button>
        <a href="/">Til forsiden</a>
      </div>
    );
  }
}
