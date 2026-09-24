import { forwardRef } from "react";

export const AnimatedList = forwardRef(function AnimatedList(
  { children, className = "", style },
  ref,
) {
  return (
    <div ref={ref} className={`animated-list ${className}`.trim()} role="list" style={style}>
      {children}
    </div>
  );
});

export const AnimatedListItem = forwardRef(function AnimatedListItem(
  { children, className = "", index = 0, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`animated-list-item ${className}`.trim()}
      role="listitem"
      style={{ ...style, "--animated-list-order": Math.min(index, 8) }}
      {...props}
    >
      {children}
    </div>
  );
});
