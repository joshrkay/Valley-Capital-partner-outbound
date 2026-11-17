import { redirect } from 'next/navigation';

// Home is This week (D-UI4): what changed, and whom to call first.
export default function Home() {
  redirect('/triage');
}
