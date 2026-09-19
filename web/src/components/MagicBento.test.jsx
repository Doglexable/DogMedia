import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MagicBento, { BentoCardGrid } from './MagicBento';

describe('MagicBento', () => {
  it('renders default Dogmedia branded cards when no items are provided', () => {
    const markup = renderToStaticMarkup(<MagicBento />);
    expect(markup).toContain('card-grid');
    expect(markup).toContain('Now Playing');
    expect(markup).toContain('Media Vault');
    expect(markup).toContain('Direct Stream');
    expect(markup).toContain('Zero Telemetry');
  });

  it('renders custom items using renderCard for Now Playing playback sessions', () => {
    const mockSessions = [
      {
        ip: '192.168.1.50',
        mediaId: 42,
        action: 'play',
        title: 'Bohemian Rhapsody',
        duration: 354,
        position: 120,
      },
      {
        ip: '192.168.1.99',
        mediaId: 88,
        action: 'pause',
        title: 'Interstellar Soundtrack',
        duration: 240,
        position: 45,
      },
    ];

    const markup = renderToStaticMarkup(
      <MagicBento
        items={mockSessions}
        renderCard={(session) => (
          <div className="magic-bento-now-playing" data-testid={`session-${session.mediaId}`}>
            <span className="magic-bento-now-playing__ip">{session.ip}</span>
            <h3 className="magic-bento-now-playing__title">{session.title}</h3>
          </div>
        )}
      />
    );

    expect(markup).toContain('192.168.1.50');
    expect(markup).toContain('Bohemian Rhapsody');
    expect(markup).toContain('192.168.1.99');
    expect(markup).toContain('Interstellar Soundtrack');
    expect(markup).toContain('magic-bento-card');
  });

  it('renders children directly inside BentoCardGrid', () => {
    const markup = renderToStaticMarkup(
      <BentoCardGrid>
        <div className="custom-card">Custom Content</div>
      </BentoCardGrid>
    );

    expect(markup).toContain('card-grid');
    expect(markup).toContain('custom-card');
    expect(markup).toContain('Custom Content');
  });

  it('ensures MagicBento.css strictly uses project color tokens with zero hardcoded hex colors', () => {
    const cssPath = path.resolve(__dirname, './MagicBento.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Check for hardcoded hex colors
    const hexMatches = css.match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(hexMatches).toBeNull();

    // Verify token integration
    expect(css).toContain('--bento-primary: var(--playback-signal, var(--primary));');
    expect(css).toContain('--bento-border: var(--card-border);');
    expect(css).toContain('--bento-card-bg: var(--card-bg);');
  });
});
