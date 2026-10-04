// Calls a dev API route that logs a server error and answers 500.
export default function Save() {
  return (
    <button id="save" onClick={() => fetch("/api/fail", { method: "POST" })}>
      Save
    </button>
  )
}
