import * as React from "react";
import { Menu, RotateCcw, CircleX } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "../../types.ts";

interface SettingsMenuProps {
  annotation: boolean;
  onToggleAnnotate: () => void;
  annotateChord: string;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  onReload: () => void;
  onEnd: () => void;
}

export function SettingsMenu({
  annotation,
  onToggleAnnotate,
  annotateChord,
  theme,
  onThemeChange,
  onReload,
  onEnd,
}: SettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu"
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Menu className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Tools</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={annotation}
            onCheckedChange={() => onToggleAnnotate()}
            onSelect={(e) => e.preventDefault()}
          >
            Annotate
            <DropdownMenuShortcut>{annotateChord}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onReload}>
            <RotateCcw /> Reload
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onEnd}>
            <CircleX /> End review
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => onThemeChange(v as Theme)}
        >
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
