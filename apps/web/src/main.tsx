import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";

// App routing + auth context land in the next build chunk. This is a
// placeholder so the dev server boots after `npm install`.
function Boot() {
  return (
    <main className="min-h-dvh grid place-items-center px-6">
      <div className="max-w-md text-center space-y-3">
        <p className="font-serif text-3xl text-ink">Rush HQ</p>
        <p className="text-muted">
          Foundation scaffolded. App routing arrives in the next build chunk.
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
