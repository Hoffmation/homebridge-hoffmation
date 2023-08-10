import { HAP } from 'homebridge/lib/api';

export let hap: HAP;

export function setHap(hapInstance: HAP) {
  hap = hapInstance;
}
