import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/Toast';
import { CategoriesStep } from './CategoriesStep';
import { CurrencyStep } from './CurrencyStep';
import { ExtrasStep } from './ExtrasStep';
import { FinishStep } from './FinishStep';
import { nextStep, prevStep, type Progress, type StepId } from './onboardingLogic';
import { StartStep } from './StartStep';
import { WalletsStep } from './WalletsStep';

export interface OnboardingWizardProps {
  progress: Progress;
  update: (change: (p: Progress) => Progress) => void;
}

/** Полноэкранная пошаговая настройка. Каждый шаг сразу пишет сделанное в базу, а номер шага — на устройство. */
export default function OnboardingWizard({ progress, update }: OnboardingWizardProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const step: StepId = progress.step;

  const go = (s: StepId) => update((p) => ({ ...p, step: s }));
  const next = () => go(nextStep(step));
  const back = () => go(prevStep(step));
  const close = (to: string | null, skipped = false) => {
    update((p) => ({ ...p, done: true, skipped }));
    if (to) navigate(to);
  };

  switch (step) {
    case 'start':
      return (
        <StartStep
          onScratch={() => update((p) => ({ ...p, path: 'scratch', step: 'currency' }))}
          onZenmoney={() => {
            update((p) => ({ ...p, path: 'import' }));
            navigate('/import');
          }}
          onBackup={() => {
            update((p) => ({ ...p, path: 'import' }));
            navigate('/settings?section=data');
            toast.show('Найдите «Резервная копия» и нажмите «Загрузить копию».', { tone: 'info' });
          }}
          onSkip={() => close(null, true)}
        />
      );
    case 'currency':
      return <CurrencyStep onBack={back} onNext={next} />;
    case 'wallets':
      return <WalletsStep onBack={back} onNext={next} />;
    case 'categories':
      return <CategoriesStep onBack={back} onNext={next} />;
    case 'extras':
      return <ExtrasStep wants={progress.wants} onChange={(wants) => update((p) => ({ ...p, wants }))} onBack={back} onNext={next} />;
    case 'finish':
      return (
        <FinishStep
          wants={progress.wants}
          onBack={back}
          onFirstOperation={() => close('/add')}
          onHome={() => close(null)}
          onSettings={() => close('/settings?section=security')}
        />
      );
  }
}
