import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import type { KitchenTimer } from '../kitchen/session.ts';
import { timerState } from '../kitchen/session.ts';
import { newlyDueTimers, parseKitchenVoiceCommand, stepSpeechText } from '../kitchen/hands-free.ts';

interface VoiceResult {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface VoiceRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: VoiceResult) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => VoiceRecognizer;
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
};
function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const voiceWindow = window as SpeechWindow;
  return voiceWindow.SpeechRecognition ?? voiceWindow.webkitSpeechRecognition ?? null;
}
function speechAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.speechSynthesis &&
    typeof window.SpeechSynthesisUtterance === 'function';
}
interface Props {
  recipeId: string;
  stepIndex: number;
  stepCount: number;
  stepTitle: string | null;
  stepInstruction: string;
  timers: readonly KitchenTimer[];
  now: number;
  onNext: () => void;
  onPrevious: () => void;
}
export function KitchenHandsFree({
  recipeId, stepIndex, stepCount, stepTitle, stepInstruction,
  timers, now, onNext, onPrevious,
}: Props) {
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [spokenAlerts, setSpokenAlerts] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState('');
  const recognizer = useRef<VoiceRecognizer | null>(null);
  const spoke = useRef(false);
  const controls = useRef({ onNext, onPrevious, stepIndex, stepCount, stepTitle, stepInstruction });
  controls.current = { onNext, onPrevious, stepIndex, stepCount, stepTitle, stepInstruction };
  // Timers already overdue when a saved session opens remain visible, without replaying old alarms.
  const acknowledged = useRef(new Set(timers.filter(t => timerState(t, now) === 'finished').map(t => t.id)));
  const hasRecognition = recognitionConstructor() !== null;
  const canSpeak = speechAvailable();
  const notificationSupported = typeof window !== 'undefined' && window.isSecureContext &&
    typeof window.Notification === 'function';

  const stopListening = useCallback(() => {
    const current = recognizer.current;
    recognizer.current = null;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      try { current.abort(); } catch { /* permission revocation or browser shutdown */ }
    }
    setListening(false);
  }, []);

  const say = useCallback((message: string) => {
    if (!speechAvailable()) {
      setVoiceStatus('Speech playback is not supported here. Read the step on screen.');
      return;
    }
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(message);
      utterance.rate = 0.9;
      spoke.current = true;
      window.speechSynthesis.speak(utterance);
    } catch {
      setVoiceStatus('Speech playback failed. The written instructions remain available.');
    }
  }, []);

  const readStep = useCallback(() => {
    const current = controls.current;
    stopListening();
    say(stepSpeechText(current.stepIndex + 1, current.stepCount,
      current.stepTitle, current.stepInstruction));
  }, [say, stopListening]);

  const startListening = () => {
    if (listening) { stopListening(); setVoiceStatus('Microphone stopped.'); return; }
    const Constructor = recognitionConstructor();
    if (!Constructor) {
      setVoiceStatus('Speech recognition is unavailable. Use the buttons below.');
      return;
    }
    if (spoke.current && speechAvailable()) window.speechSynthesis.cancel();
    try {
      const active = new Constructor();
      active.lang = navigator.language || 'en-US';
      active.continuous = false;
      active.interimResults = false;
      active.onresult = event => {
        const result = event.results[event.resultIndex];
        if (!result?.isFinal) return;
        const command = parseKitchenVoiceCommand(result[0]?.transcript ?? '');
        stopListening(); // Push-to-talk: one command, never an unattended hot microphone.
        if (command === 'next') {
          if (controls.current.stepIndex < controls.current.stepCount - 1) controls.current.onNext();
          setVoiceStatus('Next step selected. Completion was not marked.');
        } else if (command === 'previous') {
          if (controls.current.stepIndex > 0) controls.current.onPrevious();
          setVoiceStatus('Previous step selected.');
        } else if (command === 'read') {
          readStep();
          setVoiceStatus('Reading the current step.');
        } else if (command === 'stop') {
          setVoiceStatus('Microphone stopped.');
        } else {
          setVoiceStatus('Command not recognized. Say next step, previous step, or read step.');
        }
      };
      active.onerror = event => {
        stopListening();
        setVoiceStatus(event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was blocked. You can still use all cooking controls.'
          : 'Voice recognition ended without a command. Use the on-screen controls.');
      };
      active.onend = () => {
        if (recognizer.current === active) {
          recognizer.current = null;
          setListening(false);
        }
      };
      recognizer.current = active;
      active.start(); // Only on explicit user click.
      setListening(true);
      setVoiceStatus('Listening for one command. Say next step, previous step, or read step.');
    } catch {
      stopListening();
      setVoiceStatus('Microphone could not start. The controls below still work.');
    }
  };

  const allowNotifications = async () => {
    if (!notificationSupported) {
      setNotificationStatus('System notifications unavailable. Finished timers stay visible here.');
      return;
    }
    try {
      const permission = await window.Notification.requestPermission();
      setNotificationsEnabled(permission === 'granted');
      setNotificationStatus(permission === 'granted'
        ? 'Notifications enabled for this open cooking session.'
        : 'Notifications not permitted. Finished timers remain visible on screen.');
    } catch {
      setNotificationsEnabled(false);
      setNotificationStatus('Notifications unavailable. Finished timers remain visible on screen.');
    }
  };

  useEffect(() => {
    const newlyFinished = newlyDueTimers(timers, now, acknowledged.current);
    if (!newlyFinished.length) return;
    const message = newlyFinished.length === 1
      ? newlyFinished[0]!.label + ' timer finished.'
      : newlyFinished.map(t => t.label).join(', ') + ' timers finished.';
    if (spokenAlerts) say(message);
    if (notificationsEnabled && notificationSupported && window.Notification.permission === 'granted') {
      // Generic lock-screen wording: recipe titles/ingredients never leave the app.
      for (const timer of newlyFinished) {
        try {
          new window.Notification('Recipe timer finished', {
            body: 'Return to your cooking session to review the timer.',
            tag: 'recipe-timer-' + timer.id,
          });
        } catch {
          setNotificationStatus('System notification failed. Check the visible finished timers.');
        }
      }
    }
  }, [now, timers, spokenAlerts, notificationsEnabled, notificationSupported, say]);

  useEffect(() => () => {
    const current = recognizer.current;
    if (current) {
      current.onresult = null; current.onerror = null; current.onend = null;
      try { current.abort(); } catch { /* browser teardown */ }
      recognizer.current = null;
    }
    if (spoke.current && speechAvailable()) window.speechSynthesis.cancel();
  }, [recipeId]);

  const expired = timers.filter(timer => timerState(timer, now) === 'finished');
  return <section className="kitchen-handsfree" aria-labelledby="kitchen-handsfree-title">
    <div className="kitchen-handsfree-heading">
      <div><p className="eyebrow">Optional cooking assistant</p><h2 id="kitchen-handsfree-title">Hands-free cooking</h2></div>
      <span>Step {stepIndex + 1} of {stepCount}</span>
    </div>
    <div className="kitchen-handsfree-actions" role="group" aria-label="Cooking accessibility controls">
      <button type="button" disabled={stepIndex === 0} onClick={onPrevious}>
        <ArrowLeft size={17}/> Previous step
      </button>
      <button type="button" disabled={!canSpeak} onClick={readStep}>
        <Volume2 size={17}/> Read step
      </button>
      <button type="button" disabled={stepIndex >= stepCount - 1} onClick={onNext}>
        Next step <ArrowRight size={17}/>
      </button>
      {hasRecognition
        ? <button type="button" aria-pressed={listening} onClick={startListening}>
            {listening ? <MicOff size={17}/> : <Mic size={17}/>}
            {listening ? 'Stop listening' : 'Listen for one command'}
          </button>
        : <span className="kitchen-handsfree-unsupported">Voice recognition unavailable; buttons still work.</span>}
    </div>
    <div className="kitchen-handsfree-settings">
      <label>
        <input type="checkbox" checked={spokenAlerts} disabled={!canSpeak}
          onChange={event => setSpokenAlerts(event.target.checked)}/>
        <span><VolumeX size={16}/> Speak new timer alerts</span>
      </label>
      <button type="button" onClick={() => void allowNotifications()} disabled={!notificationSupported || notificationsEnabled}>
        <Bell size={16}/> {notificationsEnabled ? 'Notifications enabled' : 'Enable system notifications'}
      </button>
    </div>
    <p className="kitchen-handsfree-note">Voice listens for one command only after you press Listen.
      Your browser may process speech remotely. Navigation never marks a step complete.
      Timer alerts require this page to run; closed tabs and background devices may suppress sound or notifications.</p>
    {voiceStatus && <p className="kitchen-handsfree-status" role="status">{voiceStatus}</p>}
    {notificationStatus && <p className="kitchen-handsfree-status" role="status">{notificationStatus}</p>}
    {expired.length > 0 && <p className="kitchen-handsfree-due" role="alert">
      <Bell size={17}/> Time is up: {expired.map(timer => timer.label).join(', ')}.
      Dismiss the finished {expired.length === 1 ? 'timer' : 'timers'} below.
    </p>}
  </section>;
}
