"use client";
import { createContext } from "react";

/**
 * The depth of the segment a component renders in: the SegmentBoundary
 * nearest above it, or 0 above them all - the root layout.
 *
 * A section reads it to say which navigation replaces it. A navigation
 * answered at depth 3 renders everything from that boundary down, so a
 * section of a layout above it stays mounted, and what an action last put
 * there is still the answer.
 *
 * In its own module for the reason useLinkStatus is: one that exported a
 * component beside this could not be fast-refreshed.
 */
export const SegmentDepthContext = createContext(0);
