/**
 * Loan Audit PRO — src/ui-types/react-shim.d.ts
 * ------------------------------------------------------------------
 * Minimal ambient React 19 typings for the UI shell.
 *
 * The offline environment has the React 19 runtime but no
 * @types/react and React ships no bundled declarations. This file
 * provides only the slice of the React surface the shell uses
 * (function components, hooks, the automatic JSX runtime and a
 * permissive intrinsic-element table). It is intentionally small and
 * lives apart from the locked domain/engine code, which remains pure
 * TypeScript with no React dependency.
 */

declare module 'react' {
  export type Key = string | number;
  export type ReactNode =
    | ReactElement
    | string
    | number
    | boolean
    | null
    | undefined
    | ReactNode[];

  export interface ReactElement {
    readonly type: unknown;
    readonly props: unknown;
    readonly key: Key | null;
  }

  export type FC<P = Record<string, unknown>> = (props: P) => ReactElement | null;
  export type FunctionComponent<P = Record<string, unknown>> = FC<P>;

  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T>(fn: T, deps: readonly unknown[]): T;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;

  export function createElement(
    type: unknown,
    props?: unknown,
    ...children: unknown[]
  ): ReactElement;

  export interface FragmentProps {
    children?: ReactNode;
  }
  export const Fragment: FC<FragmentProps>;

  // Default export doubles as a namespace, so both `import React from
  // 'react'` value use and qualified types `React.FC` / `React.ReactNode`
  // resolve (mirrors how React's real d.ts is consumed). Required under
  // verbatimModuleSyntax where the default import is the only binding.
  namespace React {
    export type FC<P = Record<string, unknown>> = (props: P) => ReactElement | null;
    export type FunctionComponent<P = Record<string, unknown>> = FC<P>;
    export type ReactNode =
      | ReactElement
      | string
      | number
      | boolean
      | null
      | undefined
      | ReactNode[];
    export type ReactElement = import('react').ReactElement;
    export type Key = string | number;
  }
  const React: {
    createElement: typeof createElement;
    Fragment: typeof Fragment;
    useState: typeof useState;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useEffect: typeof useEffect;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  import type { ReactElement, ReactNode, Key } from 'react';
  export const Fragment: unique symbol;
  export function jsx(type: unknown, props: unknown, key?: Key): ReactElement;
  export function jsxs(type: unknown, props: unknown, key?: Key): ReactElement;
  export type { ReactElement, ReactNode };
}

declare module 'react-dom/server' {
  import type { ReactElement } from 'react';
  export function renderToStaticMarkup(element: ReactElement): string;
  export function renderToString(element: ReactElement): string;
}

declare module 'react-dom/client' {
  import type { ReactElement } from 'react';
  export interface Root {
    render(children: ReactElement): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

/**
 * Permissive JSX namespace: every intrinsic element accepts any
 * props. Enough for a structural shell; not a substitute for full
 * DOM typings.
 */
declare namespace JSX {
  type Element = import('react').ReactElement;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [elemName: string]: Record<string, unknown>;
  }
}

// Vite injects import.meta.env at build/dev time. Declared minimally here
// so `tsc --noEmit` typechecks; at runtime under tsx it is simply undefined
// and the code falls back to a "/" base.
interface ImportMeta {
  readonly env?: {
    readonly BASE_URL?: string;
    readonly [key: string]: unknown;
  };
}
