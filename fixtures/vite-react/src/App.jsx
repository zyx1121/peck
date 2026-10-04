// Line numbers matter: the smoke test expects the <h1> below on line 11.
export default function App() {
  return (
    <main>
      <Header title="Fixture headline" />
    </main>
  )
}

function Header({ title }) {
  return <h1 id="title">{title}</h1>
}
