# Changelog

<!--
  Placeholder for the next version (at the beginning of the line):
  ## **WORK IN PROGRESS**
  * (theimo1221) Update packages
-->
## 0.4.16 (2024-12-26)
* (theimo1221) Add Smoke Sensor

## 0.4.15 (2024-11-17)
* (theimo1221) Handle target lock state only allows 0 and 1

## 0.4.14 (2024-11-17)
* (theimo1221) Add handle sensor handling

## 0.4.13 (2024-10-12)
* (theimo1221) Backwards compatibility

## 0.4.12 (2024-10-12)
* (theimo1221) Update packages
* (theimo1221) Compatibility with latest hoffmation-base

## 0.4.11 (2024-04-19)
* (theimo1221) Camera Device was not updated --> no motion image used

## 0.4.10 (2024-04-19)
* (theimo1221) Extend logging

## 0.4.9 (2024-04-19)
* (theimo1221) Prefer camera motion images over fresh ones (if present)

## 0.4.8 (2024-03-29)
* (theimo1221) Extend dimmer logging

## 0.4.7 (2024-03-29)
* (theimo1221) Increase setLamp Debouncing from 200ms to 400ms

## 0.4.6 (2024-03-29)
* (theimo1221) Prevent double setting the dimmer (e.g. when using the slider)

## 0.4.5 (2024-03-23)
* (theimo1221) Add user-agent to requests

## 0.4.4 (2024-03-20)
* (theimo1221) Prevent duplicate api-calls for dimmer changes

## 0.4.3 (2024-03-19)

* (theimo1221) Prevent duplicate api-calls for dimmer changes
* (theimo1221) Update packages

## 0.4.2 (2024-01-06)

* (theimo1221) Fix for negative Brightness values

## 0.4.1 (2024-01-04)

* (theimo1221) Revert to got 11.8.6

## 0.4.0 (2024-01-04)

* (theimo1221) Update packages
* (theimo1221) Minor Correction for "on" state of some lamps/actors

## 0.3.5 (2023-10-14)

* (theimo1221) Minor fixes for garage door opener

## 0.3.4 (2023-10-14)

* (theimo1221) Extend logging and add dependency

## 0.3.3 (2023-10-14)

* (theimo1221) Update packages

## 0.3.2 (2023-10-14)

* (theimo1221) Add GarageDoor Opener

## 0.3.1 (2023-10-04)

* (theimo1221) Don't treat cameras as motion sensors

## 0.3.0 (2023-10-04)

* (theimo1221) Update packages
* (theimo1221) Allow setting, which devices should be included and which not.

## 0.2.5 (2023-08-12)

* (theimo1221) Next RTSP try (with option to disable)

## 0.2.4 (2023-08-11)

* (theimo1221) Temporarily revert to normal camera stream

## 0.2.3 (2023-08-11)

* (theimo1221) Switch to rtsp

## 0.2.2 (2023-08-11)

* (theimo1221) Allow On/Off control of AC devices
* (theimo1221) Optimize camera performance

## 0.2.1 (2023-08-10)

* (theimo1221) Fix negative shutter positions

## 0.2.0 (2023-08-10)

* (theimo1221) Add onboard Camera Handling to Hoffmation

## 0.1.1 (2023-08-07)

* (theimo1221) Fix dependency issue with hoffmation-base

## 0.1.0 (2023-08-07)

* (theimo1221) Initial Version with lights, scenes, dimmer, actuator, motion sensor, temperature sensor, shutter
