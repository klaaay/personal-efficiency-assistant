import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/utils";

// Adapted from https://coss.com/ui/r/tabs.json.
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  );
}

function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative isolate flex w-fit max-w-full items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tab-indicator"
        className="pointer-events-none absolute top-0 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) rounded-md bg-background shadow-sm ring-1 ring-foreground/5 transition-[width,height,translate] duration-200 ease-in-out motion-reduce:transition-none"
      />
    </TabsPrimitive.List>
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative flex min-h-9 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      keepMounted
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring data-hidden:hidden",
        className
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsPanel };
