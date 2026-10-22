"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type SearchableSelectItem = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
};

export function SearchableSelect({
  value,
  items,
  placeholder,
  searchPlaceholder,
  emptyText,
  disabled = false,
  onValueChange,
}: {
  value: string;
  items: SearchableSelectItem[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => items.find((item) => item.value === value), [items, value]);

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="min-w-0 flex-1 justify-between font-normal">
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
      <Command>
        <CommandInput placeholder={searchPlaceholder} />
        <CommandList>
          <CommandEmpty>{emptyText}</CommandEmpty>
          {items.map((item) => <CommandItem
            key={item.value}
            value={`${item.label} ${item.description ?? ""} ${item.searchText ?? ""} ${item.value}`}
            onSelect={() => { onValueChange(item.value); setOpen(false); }}
          >
            <Check className={cn("size-4", value === item.value ? "opacity-100" : "opacity-0")} />
            <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.description && <span className="block truncate text-xs text-muted-foreground">{item.description}</span>}</span>
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
