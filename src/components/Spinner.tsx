// A small loading spinner using the Quorum mark. Use on panel/surface
// backgrounds — the mark is brand-orange, so it won't read on an orange button.
export default function Spinner({ className = "w-4 h-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/quorum-mark.png"
      alt=""
      aria-hidden="true"
      className={`${className} animate-spin shrink-0`}
    />
  );
}
