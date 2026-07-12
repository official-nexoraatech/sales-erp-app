import { forwardRef } from 'react';
import { Input, type InputProps } from '@erp/ui';

type Props = InputProps;

// size="lg" (48px) by default — meets --pos-touch-target (44px) for cashier-screen
// tap accuracy; same Input primitive the rest of the app uses, no separate component.
const POSInput = forwardRef<HTMLInputElement, Props>(({ size = 'lg', ...rest }, ref) => (
  <Input {...rest} ref={ref} size={size} />
));

POSInput.displayName = 'POSInput';
export default POSInput;
