import { sendLink } from './actions.js';

export const metadata = { title: 'Sign in · Valley Capital outbound' };

export default function Login() {
  return (
    <div className="panel" style={{ maxWidth: 460 }}>
      <h1>Sign in</h1>
      <p className="sub">For the firm's principals only. You will get a one-time link by email.</p>
      <form action={sendLink} className="row">
        <label style={{ flex: '1 1 240px' }}>Work email<input type="email" name="email" required autoComplete="email" /></label>
        <button type="submit">Send link</button>
      </form>
    </div>
  );
}
