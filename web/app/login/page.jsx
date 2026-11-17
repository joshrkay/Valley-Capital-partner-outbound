import { sendLink } from './actions.js';

export const metadata = { title: 'Sign in · Valley Capital outbound' };

export default function Login() {
  return (
    <div className="panel signin">
      <h1>Sign in</h1>
      <p className="sub">For the firm's principals only. You will get a one-time link by email.</p>
      <form action={sendLink} className="row">
        <label className="grow">Work email<input type="email" name="email" required autoComplete="email" /></label>
        <button type="submit">Send link</button>
      </form>
    </div>
  );
}
