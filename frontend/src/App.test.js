import { render, screen } from '@testing-library/react';
import App from './App';

test('renders trajectory viewer selection screen', () => {
  render(<App />);
  const heading = screen.getByRole('heading', { name: /trajectory viewer/i });
  expect(heading).toBeInTheDocument();
  const selectionPrompt = screen.getByText(/select a deliverable trajectory/i);
  expect(selectionPrompt).toBeInTheDocument();
});
