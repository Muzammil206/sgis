import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { clientApi } from '@/lib/api.js';
import { exportToCSV } from '@/lib/csv.js';
import { PageHeader, PageContent } from '@/components/layout/AppLayout.jsx';
import {
  Button, Badge, Table, Pagination, SearchBar, Modal,
  Input, Select, Textarea, SectionDivider, Card,
} from '@/components/ui/index.jsx';
import { fmt } from '@/lib/utils.js';
import { useAuthStore } from '@/store/auth.js';

const DOC_LABELS = {
  docCfcForm:              'CFC Form',
  docCartographicReport:   'Cartographic Report',
  docInspectionReport:     'Inspection Report',
  docIdentificationReport: 'Identification Report',
  docLodgementReport:      'Lodgement Report',
};

export default function Clients() {
  const navigate    = useNavigate();
  const [sp]        = useSearchParams();
  const { user }    = useAuthStore();
  const qc          = useQueryClient();
  const [page, setPage]           = useState(1);
  const [q, setQ]                 = useState('');
  const [status, setStatus]       = useState('');
  const [showCreate, setShowCreate] = useState(sp.get('new') === '1');

  const params = { page, limit: 20, ...(q && { q }), ...(status && { status }) };
  const { data, isLoading } = useQuery(['clients', params], () => clientApi.list(params).then(r => r.data));

  const columns = [
    {
      key: 'plan_number', label: 'Plan Number',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--forest)', fontWeight: 600 }}>{v}</span>,
    },
    { key: 'applicant_name', label: 'Applicant' },
    {
      key: 'cfc_no', label: 'CFC No.',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--s500)' }}>{v || '—'}</span>,
    },
    {
      key: 'lodgement_no', label: 'Lodgement No.',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--s500)' }}>{v || '—'}</span>,
    },
    {
      key: 'beacon_no', label: 'Beacon',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--s500)' }}>{v || '—'}</span>,
    },
    {
      key: 'doc_cfc_form', label: 'Docs',
      render: (_, row) => {
        const n = [row.doc_cfc_form, row.doc_cartographic_report, row.doc_inspection_report, row.doc_identification_report, row.doc_lodgement_report].filter(Boolean).length;
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: n === 5 ? 'var(--emerald)' : '#92400E' }}>
            {n}/5
          </span>
        );
      },
    },
    {
      key: 'charting_date', label: 'Charting',
      render: v => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: v ? 'var(--emerald)' : 'var(--s300)' }}>
          {v ? fmt.date(v) : 'Pending'}
        </span>
      ),
    },
    {
      key: 'lodged_at', label: 'Date Lodged',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--s500)' }}>{fmt.date(v)}</span>,
    },
    { key: 'status', label: 'Status', render: v => <Badge status={v} /> },
    {
      key: 'workflow_link', label: 'Workflow',
      render: (_, row) => (
        <button
          onClick={e => { e.stopPropagation(); navigate(`/workflow/${encodeURIComponent(row.plan_number)}`); }}
          style={{ padding: '3px 10px', background: 'var(--emerald-light)', border: '1px solid var(--emerald-mid)', borderRadius: 20, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--emerald)', cursor: 'pointer', fontWeight: 600 }}
        >
          Open →
        </button>
      ),
    },
  ];

  const handleExport = () => {
    if (!data?.data?.length) return;
    exportToCSV(
      [
        ['Plan Number', 'Applicant', 'CFC No.', 'Lodgement No.', 'Land No.', 'Survey No.', 'Beacon', 'Docs', 'Charting Date', 'Status', 'Lodged'],
        ...data.data.map(r => [
          r.plan_number, r.applicant_name, r.cfc_no, r.lodgement_no,
          r.land_no, r.survey_no, r.beacon_no || '',
          [r.doc_cfc_form, r.doc_cartographic_report, r.doc_inspection_report, r.doc_identification_report, r.doc_lodgement_report].filter(Boolean).length,
          r.charting_date || '', r.status, r.lodged_at,
        ]),
      ],
      'ClientLodgments'
    );
  };

  return (
    <>
      <PageHeader
        title="Client Lodgments"
        subtitle="DB3 — Client CofO applications · 5 reference numbers auto-generated per record"
        badge="DB3"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="sm" onClick={handleExport}
              icon={<svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>}>
              Export
            </Button>
            {user?.role !== 'viewer' && (
              <Button
                onClick={() => setShowCreate(true)}
                icon={<svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>}
              >
                New Client Lodgment
              </Button>
            )}
          </div>
        }
      />
      <PageContent>
        <div style={{ display: 'flex', gap: 8 }}>
          <SearchBar value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Plan number, applicant, CFC number…" style={{ flex: 1 }} />
          <Select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={{ width: 165 }}
            options={[
              { value: '',             label: 'All statuses'  },
              { value: 'received',     label: 'Received'      },
              { value: 'under_review', label: 'Under Review'  },
              { value: 'approved',     label: 'Approved'      },
              { value: 'rejected',     label: 'Rejected'      },
              { value: 'on_hold',      label: 'On Hold'       },
            ]} />
        </div>

        <Card>
          <div style={{ padding: '10px 14px', background: 'var(--s50)', borderBottom: '1px solid var(--s200)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--s500)' }}>
              {isLoading ? 'Loading…' : `${data?.total ?? 0} records`}
            </span>
          </div>
          <Table columns={columns} data={data?.data} loading={isLoading} keyField="id"
            emptyMessage="No client lodgments found"
            onRowClick={row => navigate(`/applications/${encodeURIComponent(row.plan_number)}`)} />
          <Pagination page={page} totalPages={data?.totalPages || 1} onChange={setPage} />
        </Card>
      </PageContent>

      <CreateClientModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        defaultPlan={sp.get('plan') || ''}
        onSuccess={() => { setShowCreate(false); qc.invalidateQueries('clients'); }}
      />
    </>
  );
}

/* ─── Create Client Lodgment Modal — ALL 3 SECTIONS COMPLETE (GAP 1) ──── */
function CreateClientModal({ open, onClose, defaultPlan, onSuccess }) {
  const { register, handleSubmit, watch, setValue, formState: { errors }, reset } = useForm({
    defaultValues: {
      planNumber:          defaultPlan,
      submittedBySurveyor: 'false',
      status:              'received',
      docCfcForm:              false,
      docCartographicReport:   false,
      docInspectionReport:     false,
      docIdentificationReport: false,
      docLodgementReport:      false,
    },
  });
  const [apiError, setApiError] = useState('');

  /* Watch the doc checkboxes for live count */
  const docValues = watch(['docCfcForm','docCartographicReport','docInspectionReport','docIdentificationReport','docLodgementReport']);
  const docCount  = docValues.filter(Boolean).length;

  const mutation = useMutation(data => clientApi.create(data), {
    onSuccess: () => { reset(); setApiError(''); onSuccess(); },
    onError:   err => setApiError(err.response?.data?.error || 'An error occurred.'),
  });

  const submit = handleSubmit(data => {
    setApiError('');
    mutation.mutate({
      ...data,
      submittedBySurveyor: data.submittedBySurveyor === 'true',
      sizeSqm:             data.sizeSqm    ? Number(data.sizeSqm)    : undefined,
      inGovtAcquisition:   data.inGovtAcquisition    === '' ? undefined : data.inGovtAcquisition    === 'YES',
      withinExistingTitle: data.withinExistingTitle   === '' ? undefined : data.withinExistingTitle   === 'YES',
      freeFromAcquisition: data.freeFromAcquisition   === '' ? undefined : data.freeFromAcquisition   === 'YES',
    });
  });

  const DocCheckbox = ({ name, label }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', borderBottom: '1px solid var(--s100)', userSelect: 'none', transition: 'background .12s', background: watch(name) ? '#ECFDF5' : '#fff' }}
      onMouseOver={e => { if (!watch(name)) e.currentTarget.style.background = 'var(--s50)'; }}
      onMouseOut={e => { if (!watch(name)) e.currentTarget.style.background = '#fff'; }}
    >
      <input type="checkbox" {...register(name)} style={{ width: 16, height: 16, accentColor: 'var(--emerald)', cursor: 'pointer' }} />
      <span style={{ flex: 1, fontSize: 13.5, color: watch(name) ? 'var(--s900)' : 'var(--s500)', fontWeight: watch(name) ? 500 : 400 }}>
        {label}
      </span>
      {watch(name) && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--emerald)', fontWeight: 700 }}>RECEIVED</span>
      )}
    </label>
  );

  const TriBool = ({ label, name, remarksName }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--s500)' }}>
        {label}
      </label>
      <select {...register(name)}
        style={{ height: 36, padding: '0 10px', background: '#fff', border: '1px solid var(--s200)', borderRadius: 'var(--radius-sm)', fontSize: 13.5, fontFamily: 'var(--font-sans)', color: 'var(--s900)', outline: 'none', appearance: 'none', boxShadow: 'var(--shadow-xs)' }}>
        <option value="">— Not checked —</option>
        <option value="YES">YES</option>
        <option value="NO">NO</option>
      </select>
      {watch(name) && (
        <input {...register(remarksName)} placeholder="Remarks (optional)"
          style={{ height: 32, padding: '0 10px', background: '#fff', border: '1px solid var(--s200)', borderRadius: 'var(--radius-sm)', fontSize: 12.5, fontFamily: 'var(--font-sans)', color: 'var(--s900)', outline: 'none' }} />
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} size="xl"
      title="New Client Lodgment"
      subtitle="DB3 — Client brings RED COPY. OSG generates 5 reference numbers automatically on save."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={mutation.isLoading}>Save Lodgment</Button></>}
    >
      {apiError && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 13.5, color: '#991B1B', marginBottom: 16 }}>
          {apiError}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>

        {/* ── Plan Link ── */}
        <SectionDivider label="Plan Link" />
        <div style={{ gridColumn: '1/-1' }}>
          <Input label="Plan Number" required mono placeholder="KW/3465/47/2024"
            {...register('planNumber', { required: true })}
            error={errors.planNumber && 'Required'}
            hint="Plan number — auto-links to DB1 if a Pillar Application exists. Leave as-is for old or standalone records." />
        </div>

        {/* ── OSG Reference Numbers (read-only display) ── */}
        <SectionDivider label="OSG Reference Numbers — auto-generated on save" />
        <div style={{ gridColumn: '1/-1' }}>
          <div style={{ padding: '13px 16px', background: 'var(--emerald-light)', border: '1px solid var(--emerald-mid)', borderRadius: 8 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--emerald)', marginBottom: 10, fontWeight: 600 }}>
              Generated automatically on save — do not enter manually
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
              {['CFC No.', 'Lodgement No.', 'Land No.', 'Survey No.', 'CIR Ref. No.'].map(r => (
                <div key={r} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--forest)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--emerald)', display: 'inline-block', flexShrink: 0 }} />
                  {r}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Applicant ── */}
        <SectionDivider label="Applicant" />
        <Input label="Applicant Full Name" required
          {...register('applicantName', { required: true })} error={errors.applicantName && 'Required'} />
        <Input label="Phone Number" mono placeholder="080XXXXXXXX" {...register('applicantPhone')} />
        <Select label="Submitted By" required placeholder="Select…"
          options={[
            { value: 'false', label: 'Client (directly)' },
            { value: 'true',  label: 'Surveyor (on behalf of client)' },
          ]}
          {...register('submittedBySurveyor', { required: true })}
          error={errors.submittedBySurveyor && 'Required'} />
        <Select label="Initial Status" required
          options={[
            { value: 'received',     label: 'Received'      },
            { value: 'under_review', label: 'Under Review'  },
          ]}
          {...register('status', { required: true })} />
        <Input label="Date Lodged" required type="date"
          {...register('lodgedAt', { required: true })} error={errors.lodgedAt && 'Required'} />

        {/* ── Charting Data ── */}
        <SectionDivider label="Charting Data — fill if available, or update later" />
        <Input label="Beacon No." mono placeholder="PBIL. 6249" {...register('beaconNo')} />
        <Input label="Confirmed Size (m²)" type="number" step="0.001" placeholder="e.g. 544.905" {...register('sizeSqm')} />
        <Input label="Charting Date" type="date" {...register('chartingDate')} />
        <div />
        <Input label="UTM Northing" mono placeholder="940694.855 mN" {...register('utmNorthing')} />
        <Input label="UTM Easting"  mono placeholder="674291.998 mE" {...register('utmEasting')} />
        <Input label="Township Northing" mono placeholder="17447.779 mN" {...register('townshipNorthing')} />
        <Input label="Township Easting"  mono placeholder="17258.816 mE" {...register('townshipEasting')} />

        {/* ── 3 Status Checks ── */}
        <SectionDivider label="3 Charting Status Checks" />
        <TriBool label="Land in Govt. Acquisition?" name="inGovtAcquisition"   remarksName="inGovtAcquisitionRemarks" />
        <TriBool label="Within Existing Title?"      name="withinExistingTitle" remarksName="withinExistingTitleRemarks" />
        <TriBool label="Free from Acquisition?"      name="freeFromAcquisition" remarksName="freeFromAcquisitionRemarks" />
        <div />

        {/* ── Documents Checklist ── */}
        <SectionDivider label={`Documents Checklist — ${docCount}/5 marked received`} />
        <div style={{ gridColumn: '1/-1' }}>
          <div style={{ border: '1px solid var(--s200)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <DocCheckbox name="docCfcForm"              label="CFC Form"              />
            <DocCheckbox name="docCartographicReport"   label="Cartographic Report"   />
            <DocCheckbox name="docInspectionReport"     label="Inspection Report"     />
            <DocCheckbox name="docIdentificationReport" label="Identification Report" />
            <DocCheckbox name="docLodgementReport"      label="Lodgement Report"      />
            <div style={{ padding: '10px 14px', background: docCount >= 5 ? 'var(--emerald-light)' : 'var(--s50)', borderTop: '1px solid var(--s200)' }}>
              <span style={{ fontSize: 13, color: docCount >= 5 ? 'var(--emerald)' : 'var(--s500)', fontWeight: 500 }}>
                {docCount >= 5 ? '✓ All 5 documents received' : `${5 - docCount} document${5 - docCount > 1 ? 's' : ''} still outstanding`}
              </span>
            </div>
          </div>
        </div>

        <div style={{ gridColumn: '1/-1' }}>
          <Textarea label="Notes (optional)" placeholder="Optional remarks…" {...register('notes')} />
        </div>
      </div>
    </Modal>
  );
}