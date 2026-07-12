import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Input, Select, Combobox } from '@erp/ui';
import { runAxe, formatViolations } from '../../../testUtils/axe.js';

describe('@erp/ui Input', () => {
  it('shows the error message and marks the field invalid', () => {
    render(<Input label="Email" error="Email is required" />);
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the success message when there is no error', () => {
    render(<Input label="GSTIN" success="Looks good" />);
    expect(screen.getByText('Looks good')).toBeInTheDocument();
  });

  it('disables the field and prevents interaction', () => {
    render(<Input label="Name" disabled />);
    expect(screen.getByLabelText('Name')).toBeDisabled();
  });

  it('shows a clear button once there is a value, and calls onClear', () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <Input label="Search" value="" clearable onClear={onClear} onChange={() => {}} />
    );
    expect(screen.queryByLabelText('Clear')).not.toBeInTheDocument();

    rerender(<Input label="Search" value="abc" clearable onClear={onClear} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText('Clear'));
    expect(onClear).toHaveBeenCalled();
  });

  it('has no axe violations in its default, error, and disabled states', async () => {
    const { container } = render(
      <div>
        <Input label="Name" />
        <Input label="Email" error="Required" />
        <Input label="Notes" disabled />
      </div>
    );
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});

describe('@erp/ui Select', () => {
  it('renders options and reports the selected value on change', () => {
    const onChange = vi.fn();
    render(
      <Select
        label="Account Type"
        value="ASSET"
        onChange={onChange}
        options={[
          { value: 'ASSET', label: 'Asset' },
          { value: 'LIABILITY', label: 'Liability' },
        ]}
      />
    );
    fireEvent.change(screen.getByLabelText('Account Type'), { target: { value: 'LIABILITY' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Select label="Branch" options={[{ value: '1', label: 'Main' }]} onChange={() => {}} />
    );
    const violations = await runAxe(container);
    expect(violations, formatViolations(violations)).toHaveLength(0);
  });
});

describe('@erp/ui Combobox', () => {
  it('filters sync options as the user types and selects one', async () => {
    const onChange = vi.fn();
    render(
      <Combobox
        label="Customer"
        onChange={onChange}
        options={[
          { value: 1, label: 'Ramesh Textiles' },
          { value: 2, label: 'Suresh Traders' },
        ]}
      />
    );
    const input = screen.getByLabelText('Customer');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ramesh' } });

    expect(await screen.findByText('Ramesh Textiles')).toBeInTheDocument();
    expect(screen.queryByText('Suresh Traders')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText('Ramesh Textiles'));
    expect(onChange).toHaveBeenCalledWith({ value: 1, label: 'Ramesh Textiles' });
  });

  it('async loadOptions is called (debounced) and results render', async () => {
    const loadOptions = vi.fn().mockResolvedValue([{ value: 9, label: 'Async Result' }]);
    render(
      <Combobox label="Product" onChange={() => {}} loadOptions={loadOptions} debounceMs={1} />
    );

    const input = screen.getByLabelText('Product');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'as' } });

    expect(await screen.findByText('Async Result')).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledWith('as');
  });
});
