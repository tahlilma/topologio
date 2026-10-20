import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page narrow">
      <p className="eyebrow">Off the map</p>
      <h1>Nothing surveyed here</h1>
      <p className="lede">That page, game or player does not exist. The link may be mistyped.</p>
      <div className="button-row">
        <Link className="btn" href="/">Back to the start</Link>
        <Link className="btn ghost" href="/leaderboard">Leaderboard</Link>
      </div>
    </main>
  );
}
