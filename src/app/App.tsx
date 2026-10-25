import { useMemo } from "react";
import { AppletHostAdapter } from "../core/host";
import { NaturalSelectionCanvas } from "../applets/natural_selection/NaturalSelectionCanvas";

export function App(): JSX.Element {
  const host: AppletHostAdapter = useMemo(
    () => ({
      onClose: () => {},
      readReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    }),
    []
  );

  return (
    <div className="app-shell">
      <main>
        <section className="modal card">
          <NaturalSelectionCanvas host={host} />
        </section>
      </main>
    </div>
  );
}
