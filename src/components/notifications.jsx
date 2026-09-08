import React from "react";
import { toast } from "sonner";
import { Toaster as Sonner } from "./ui/sonner";
export const notify = (message) => toast(message);
export const Toaster = () => (
  <Sonner
    theme="dark"
    position="bottom-right"
    closeButton
    toastOptions={{ className: "rm-toast" }}
  />
);
