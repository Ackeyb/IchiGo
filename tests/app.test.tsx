import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app/App';

describe('application bootstrap', () => {
  it('loads the TypeScript/JSX entry component in the Node test environment', () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<h1>Ichi-Go Game</h1>');
    expect(html).toContain('<main>');
  });
});
