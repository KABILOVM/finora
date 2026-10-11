import { render } from '@/components/testUtils';
import { describe, expect, it } from 'vitest';
import { RuleIcon } from './RuleIcon';

describe('RuleIcon', () => {
  it('значок «i:…» рисуется картинкой, а не сырым кодом', () => {
    const { container } = render(<RuleIcon view={{ icon: 'i:home', color: '#8b5cf6' }} />);
    expect(container.textContent).not.toContain('i:');
    expect(container.querySelector('svg')).not.toBeNull();
  });
  it('без категории — значок вида платежа', () => {
    const { container } = render(<RuleIcon view={{ icon: '↔️', color: null }} size="sm" />);
    expect(container.firstElementChild).not.toBeNull();
    expect(container.textContent === '↔️' || container.querySelector('svg') !== null).toBe(true);
  });
});
