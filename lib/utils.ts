import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateGameCode(): string {
  const words = ["ROYAL", "FLUSH", "SPADE", "HEART", "CLUBS", "ACES", "KINGS", "QUEEN", "JOKER", "CHIPS"];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${word}-${num}`;
}

export function formatChips(chips: number): string {
  return chips.toLocaleString("en-IN");
}

export function formatRupees(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}
