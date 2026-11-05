import { Link, useNavigate } from 'react-router';
import { useDocumentTitle } from '../components/useDocumentTitle';
import { NewGameForm } from './NewGameForm';

/** Nytt spill som egen side (mobil). På større skjermer åpnes det samme skjemaet i en dialog. */
export function NewGamePage() {
  useDocumentTitle('Nytt spill');
  const navigate = useNavigate();
  return (
    <div className="page page--narrow">
      <header className="page__head">
        <div className="sc">
          <Link to="/">Mine spill</Link>
        </div>
        <h1>Nytt spill</h1>
      </header>
      <NewGameForm onCreated={(d) => navigate(`/spill/${d.game.id}/ark`)} onCancel={() => navigate('/')} />
    </div>
  );
}
