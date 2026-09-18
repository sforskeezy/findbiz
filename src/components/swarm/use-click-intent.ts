"use client";
import { useEffect, useRef, type MouseEvent } from 'react';
/** Delay pointer activation just enough to let double-click mean dismiss.
 * Keyboard activation stays immediate; copy buttons are never delayed. */
export function useClickIntent() {
  const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  function cancel(){clearTimeout(timer.current);timer.current=undefined;}
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  function open(event: MouseEvent, action:()=>void){cancel();if(event.detail===0)action();else if(event.detail===1)timer.current=setTimeout(action,300);}
  return {open,cancel};
}
export function isContactInteraction(target: EventTarget) {
  return target instanceof Element && Boolean(target.closest('input,textarea,select,a,.sw-copy-contact,.sw-icon,.sw-secondary'));
}
