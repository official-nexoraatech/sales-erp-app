import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { holidayApi } from '../../api/endpoints.js';
import ERPPageHeader from '../../components/erp/ERPPageHeader.js';
import ERPFormSection from '../../components/erp/ERPFormSection.js';
import ERPStickyFooter from '../../components/erp/ERPStickyFooter.js';
import Button from '../../components/ui/Button.js';
import Input from '../../components/ui/Input.js';
import Select from '../../components/ui/Select.js';

const LIST_PATH = '/hr/holidays';

export default function HolidayFormPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayType, setHolidayType] = useState<'NATIONAL' | 'STATE' | 'OPTIONAL'>('NATIONAL');

  const createMutation = useMutation({
    mutationFn: () => holidayApi.create({ name, holidayDate, holidayType }),
    onSuccess: () => {
      toast.success('Holiday added');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      navigate(LIST_PATH);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <ERPPageHeader
        variant="detail"
        title="Add Holiday"
        subtitle="Add a public or company holiday"
        backTo={LIST_PATH}
      />

      <ERPFormSection title="Holiday Details" columns={2}>
        <Input
          label="Holiday Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diwali"
        />
        <Input
          label="Date"
          type="date"
          value={holidayDate}
          onChange={(e) => setHolidayDate(e.target.value)}
        />
        <Select
          label="Type"
          value={holidayType}
          onChange={(e) => setHolidayType(e.target.value as 'NATIONAL' | 'STATE' | 'OPTIONAL')}
        >
          <option value="NATIONAL">National</option>
          <option value="STATE">State</option>
          <option value="OPTIONAL">Optional</option>
        </Select>
      </ERPFormSection>

      <ERPStickyFooter>
        <Button variant="secondary" onClick={() => navigate(LIST_PATH)}>
          Cancel
        </Button>
        <Button
          onClick={() => createMutation.mutate()}
          loading={createMutation.isPending}
          disabled={!name || !holidayDate}
        >
          Add Holiday
        </Button>
      </ERPStickyFooter>
    </div>
  );
}
