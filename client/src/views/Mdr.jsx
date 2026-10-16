/** Macrodata Refinement: the isolated static app in public/mdr/ (see NOTICE.md there), shown in an iframe. */
export default function Mdr() {
  return (
    <iframe
      className="mdr-frame"
      title="Macrodata Refinement: Lumon refinement screen"
      src={`${import.meta.env.BASE_URL}mdr/index.html`}
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
