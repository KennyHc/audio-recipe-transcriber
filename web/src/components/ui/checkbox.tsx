import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  className?: string;
}

/**
 * A custom-styled checkbox: a real, visually-hidden native <input type="checkbox">
 * inside a <label> (so keyboard focus, screen readers and Space-to-toggle all keep
 * working via native semantics), with a sibling box + checkmark SVG. The box's
 * appearance is driven entirely by the input's real :checked / :focus-visible state
 * via the `.checkbox-*` rules in index.css — no JS-driven className toggling.
 *
 * Wrap this (and any adjacent row text) in an element carrying the `checkbox-row`
 * class to get whole-row hover styling and the animated strike-through text
 * (`checkbox-strike` class on the text element) driven off the same input.
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { checked, onChange, ariaLabel, className },
  ref,
) {
  return (
    <label
      className={cn(
        "relative inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center",
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="checkbox-input"
      />
      <span className="checkbox-box h-full w-full rounded-[4px]" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="checkbox-check h-[68%] w-[68%]" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.4L6.6 11.5L12.5 4.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  );
});
