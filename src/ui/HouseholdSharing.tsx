import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, LockKeyhole, ShieldAlert, Users, X } from 'lucide-react';
import { NEVER_QUALIFIED, ROLE_DESCRIPTION, prepareHouseholdInvite, sharingCanActivate } from '../sharing/household.ts';
import type { HouseholdInviteDraft } from '../sharing/household.ts';

interface Props { onClose: () => void; }
export function HouseholdSharing({ onClose }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const [draft, setDraft] = useState<HouseholdInviteDraft | null>(null);
  const [error, setError] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const modalRef = useRef<HTMLElement>(null);
  const activated = sharingCanActivate(NEVER_QUALIFIED);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    modal?.querySelector<HTMLButtonElement>('.household-close')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (!modal) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href]'
      )].filter(el => el.getClientRects().length > 0);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault(); controls[controls.length - 1]?.focus();
      } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
        event.preventDefault(); controls[0]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);
  const prepare = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setDraft(prepareHouseholdInvite({ email, role }));
      setError('');
    } catch {
      setDraft(null);
      setError('Enter one valid email address and choose a proposed role.');
    }
  };
  return <div className="household-overlay" role="presentation" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="household-title"
      ref={modalRef} className="household-sheet" onMouseDown={event => event.stopPropagation()}>
      <header className="household-header">
        <div><p className="eyebrow">Private cookbook / Permissions</p>
          <h2 id="household-title">Family sharing</h2></div>
        <button type="button" className="household-close" aria-label="Close family sharing" onClick={onClose}><X size={21}/></button>
      </header>
      <p className="household-denial" role="status"><LockKeyhole size={19}/>
        Sharing is unavailable until owner-authorized server permissions and revocation pass independent qualification.
        Nothing prepared here is sent, stored or shared.
      </p>
      <div className="household-permissions">
        <h3>Understand member access</h3>
        <p>Personal recipes stay private. Household access cannot be granted by changing a client-side role or recipe visibility.</p>
        <dl>
          <div><dt>Owner</dt><dd>{ROLE_DESCRIPTION.owner}</dd></div>
          <div><dt>Editor</dt><dd>{ROLE_DESCRIPTION.editor}</dd></div>
          <div><dt>Viewer</dt><dd>{ROLE_DESCRIPTION.viewer}</dd></div>
        </dl>
      </div>
      <form onSubmit={prepare} className="household-form" noValidate>
        <h3>Prepare an invitation</h3>
        <p>Preview only. There is no invitation, email, link, or accepted membership until the server is certified.</p>
        <label>Email address
          <input type="email" name="invite-email" value={email} maxLength={254}
            autoComplete="off" placeholder="person@example.com"
            onChange={event=>{setEmail(event.target.value);setDraft(null);setError('');}}/>
        </label>
        <label>Proposed access
          <select name="invite-role" value={role} onChange={event=>{setRole(event.target.value as 'viewer'|'editor');setDraft(null);}}>
            <option value="viewer">Viewer — read only</option>
            <option value="editor">Editor — edit approved household recipes</option>
          </select>
        </label>
        <button type="submit" className="button button-secondary">Review invitation draft</button>
        {error&&<p role="alert" className="household-form-error">{error}</p>}
      </form>
      {draft&&<div className="household-preview" role="status">
        <strong>Draft prepared — not sent</strong>
        <p><span>To</span> {draft.email}</p>
        <p><span>Role</span> {draft.role}</p>
        <p>The invitation was not sent. This draft is discarded when you close the panel.</p>
        <button type="button" disabled={!activated} aria-label="Send invitation (not available)">Send invitation — unavailable</button>
      </div>}
      <div className="household-revoke">
        <h3><ShieldAlert size={17}/> Membership and revocation</h3>
        <p>There is no certified member directory to display. Do not assume an account is a household member.</p>
        <button type="button" disabled>Revoke member — unavailable</button>
      </div>
      <footer className="household-footer"><Users size={16}/>
        <span>Owner-first permissions. No server request, clipboard export, email delivery or shared writes.</span>
        <button type="button" onClick={onClose}><ArrowLeft size={15}/> Back to cookbook</button>
      </footer>
    </section>
  </div>;
}
