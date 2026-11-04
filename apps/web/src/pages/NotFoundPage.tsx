import { Link } from 'react-router';
import { useDocumentTitle } from '../components/useDocumentTitle';

export function NotFoundPage() {
  useDocumentTitle('Fant ikke siden');
  return (
    <div className="state state--center">
      <div className="state__ornament" aria-hidden="true">
        ❦
      </div>
      <h1>Fant ikke siden</h1>
      <p className="dim">Denne stien fører ingen steder.</p>
      <Link className="btn" to="/">
        Til Mine spill
      </Link>
    </div>
  );
}
