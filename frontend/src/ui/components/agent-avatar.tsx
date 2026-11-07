/**
 * The assistant's face: a robot head drawn from tokens, meant to sit on a navy
 * surface (the `c-fab` launcher, the chat header).
 *
 * The white is `--we-on-primary`, the antenna tip and eyes are `--we-accent`,
 * and the visor and mouth are cut in `--we-primary`, so the whole mark follows
 * the theme without stating a colour of its own.
 *
 * The viewBox is the mark's own bounding box: 32 wide by 30 tall, antenna tip
 * to chin.
 */
export function AgentAvatar({ className = "size-icon", title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 30"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      {/* Antenna: a short stem into the head, tipped with the accent. */}
      <path d="M15.6 5.6v3.8" stroke="var(--we-on-primary)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="15.6" cy="2.8" r="2.8" fill="var(--we-accent)" />

      {/* Ears first, so the head's rounded corners sit over where they meet. */}
      <rect x="0" y="13.6" width="5.6" height="8.2" rx="2.4" fill="var(--we-on-primary)" />
      <rect x="26.4" y="13.6" width="5.6" height="8.2" rx="2.4" fill="var(--we-on-primary)" />

      {/* The head is a rounded square; the visor fills most of it, leaving a
          thin white frame, which is what gives the face its shape. */}
      <rect x="3.9" y="8.6" width="24.2" height="21.4" rx="7.8" fill="var(--we-on-primary)" />
      <rect x="7" y="12.3" width="18" height="11.1" rx="5.5" fill="var(--we-primary)" />

      {/* Eyes, inside the visor. */}
      <path
        d="M9.6 18.7h3.6M18.4 18.7h3.6"
        stroke="var(--we-accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />

      {/* A small smile under the visor. */}
      <path d="M14 27.1q1.6 1.5 3.2 0" stroke="var(--we-primary)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
