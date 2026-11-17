import MachineSerial from '../../modules/machine-serial';

import { SerialMachineController, type SerialTransport } from './SerialMachineController';

/** The real controller: the Arduino on USB OTG, through the local machine-serial module. */
const usbTransport: SerialTransport = {
  open: (baudRate) => MachineSerial.open(baudRate),
  close: () => MachineSerial.close(),
  write: (text) => MachineSerial.write(text),
  onData: (listener) => {
    const subscription = MachineSerial.addListener('onData', (event) => listener(event.text));
    return () => subscription.remove();
  },
  onDevice: (listener) => {
    const subscription = MachineSerial.addListener('onDevice', (event) => listener(event.event));
    return () => subscription.remove();
  },
};

export function createUsbSerialMachineController(): SerialMachineController {
  return new SerialMachineController(usbTransport);
}
