"use client";

import type { ReactNode } from "react";

import { useNavigate } from "react-router";

import { RouterProvider } from "react-aria-components";

export function ReactAriaRouterProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  return <RouterProvider navigate={(href) => navigate(href.toString())}>{children}</RouterProvider>;
}
