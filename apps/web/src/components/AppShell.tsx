import { useMemo } from "react";
import { Outlet } from "react-router";
import { cn } from "cn";
import { useAuth } from "../lib/auth";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { AccountSwitcher } from "@/components/layout/header/account-switcher";
import { GitHubRepositoriesMenu } from "@/components/layout/header/github-repositories-menu";
import { LayoutControls } from "@/components/layout/header/layout-controls";
import { SearchDialog } from "@/components/layout/header/search-dialog";
import { ThemeSwitcher } from "@/components/layout/header/theme-switcher";
import { ReactAriaRouterProvider } from "@/components/layout/react-aria-router-provider";

/**
 * Layout dashboard dari next-shadcn-admin-dashboard-aria (MIT), dengan data user dan menu SCHID.
 */
export function AppShell() {
  const { user } = useAuth();

  // Pemilih akun hanya berisi user yang sedang login.
  const accounts = useMemo(
    () =>
      user
        ? [
            {
              id: user.id,
              name: user.name,
              username: user.email.split("@")[0],
              email: user.email,
              avatar: "",
              role: user.role,
            },
          ]
        : [],
    [user],
  );

  return (
    <ReactAriaRouterProvider>
      <SidebarProvider
        defaultOpen
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 68)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" collapsible="icon" />
        <SidebarInset
          className={cn(
            "[html[data-content-layout=centered]_&>*]:mx-auto",
            "[html[data-content-layout=centered]_&>*]:w-full",
            "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
            "peer-data-[variant=inset]:border",
            "min-w-0 overflow-x-clip",
          )}
        >
          <header
            className={cn(
              "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
              "[html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
            )}
          >
            <div className="flex w-full items-center justify-between px-4 lg:px-6">
              <div className="flex items-center gap-1 lg:gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator
                  orientation="vertical"
                  className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
                />
                <SearchDialog />
              </div>
              <div className="flex items-center gap-2">
                <LayoutControls />
                <ThemeSwitcher />
                <GitHubRepositoriesMenu />
                <AccountSwitcher users={accounts} />
              </div>
            </div>
          </header>
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-4 md:p-6">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <Toaster />
    </ReactAriaRouterProvider>
  );
}
