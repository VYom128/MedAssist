import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { STACK_FILE, type StackInfo } from './stack';

/**
 * The §15.2 happy path across five demo logins on a freshly seeded stack (e2e/stack.ts). Only
 * role and label selectors.
 */

const stack = JSON.parse(readFileSync(STACK_FILE, 'utf8')) as StackInfo;
const PASSWORD = 'Password@123';

/** "14 Oct 2026" in the clinic timezone, as the date picker labels days. */
const clinicDay = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: stack.timezone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto(`${stack.baseURL}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome');
}

test('reception → doctor → billing → lab → patient', async ({ page }) => {
  const [patientFirst] = stack.patient.name.split(' ');
  let invoiceNumber = '';

  await test.step('reception books today with the doctor', async () => {
    await signIn(page, 'reception1@medassist.dev');
    await page.goto(`${stack.baseURL}/reception/appointments`);
    await page.getByRole('button', { name: 'Book appointment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Book appointment' });
    await dialog.getByRole('combobox', { name: 'Patient' }).fill(patientFirst!);
    await dialog.getByRole('option', { name: new RegExp(stack.patient.name) }).click();
    const doctorSelect = dialog.getByLabel('Doctor');
    const doctorOption = doctorSelect.getByRole('option', { name: new RegExp(stack.doctor.name) });
    await doctorSelect.selectOption((await doctorOption.getAttribute('value'))!);
    await dialog.getByRole('radio', { name: new RegExp(`^${clinicDay()}: \\d+ free`) }).click();
    await dialog
      .getByRole('radio', { name: /^\d{1,2}:\d{2} (AM|PM)$/ })
      .first()
      .click();
    await dialog.getByLabel(/Reason for visit/).fill('Fever and sore throat for 3 days');
    await dialog.getByRole('button', { name: 'Book appointment' }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step('reception checks the patient in', async () => {
    await page.goto(`${stack.baseURL}/reception/queue`);
    const table = page.getByRole('table', { name: "Today's appointments" });
    const row = table.getByRole('row', { name: new RegExp(stack.patient.name) });
    await row.getByRole('button', { name: 'Check in' }).click();
    await expect(row).toBeHidden();
  });
  await test.step('doctor calls the patient and writes the note', async () => {
    await signIn(page, stack.doctor.email);
    await page.goto(`${stack.baseURL}/doctor/queue`);
    await page.getByRole('button', { name: /Call next/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: stack.patient.name })).toBeVisible();
    await page.getByRole('tab', { name: 'Notes' }).click();
    await page.getByLabel(/Chief complaint/).fill('Fever and sore throat for 3 days');
    await page.getByLabel(/Examination/).fill('Throat congested, chest clear');
    await page.getByRole('tab', { name: 'Diagnosis & plan' }).click();
    await page.getByRole('button', { name: 'Add diagnosis' }).click();
    await page.getByRole('textbox', { name: 'Diagnosis 1' }).fill('Acute pharyngitis');
    await page.getByLabel('ICD-10 (optional)').fill('J02.9');
    await page
      .getByRole('textbox', { name: 'Plan', exact: true })
      .fill('Symptomatic treatment; review if fever persists.');
    await page
      .getByRole('textbox', { name: 'Advice to patient', exact: true })
      .fill('Warm fluids and rest.');
  });

  await test.step('doctor prescribes and orders a lab test', async () => {
    await page.getByRole('tab', { name: 'Prescription' }).click();
    await page.getByRole('button', { name: 'Add drug' }).click();
    await page.getByRole('combobox', { name: 'Drug' }).fill('parac');
    await page
      .getByRole('option', { name: /Paracetamol/ })
      .first()
      .click();
    const drug = page.getByRole('listitem', { name: 'Drug 1: Paracetamol' });
    await drug.getByLabel('Timing').selectOption({ label: 'After food' });
    await drug.getByLabel('Duration (days)').fill('3');
    await drug.getByLabel('Quantity').fill('9 tablets');

    await page.getByRole('tab', { name: 'Lab orders' }).click();
    await page.getByRole('button', { name: 'Add lab tests' }).click();
    const order = page.getByRole('dialog', { name: 'Add lab tests' });
    await order.getByRole('button', { name: /Complete Blood Count/ }).click();
    await order.getByRole('button', { name: 'Save lab order' }).click();
    await expect(order).toBeHidden();
  });

  await test.step('doctor generates the AI summary', async () => {
    await page.getByRole('tab', { name: 'AI summary' }).click();
    await page.getByRole('button', { name: 'Generate summary' }).click();
    await expect(page.getByText('AI draft – review before use')).toBeVisible();
  });

  await test.step('doctor signs the note', async () => {
    await page.getByRole('button', { name: /Review & sign/ }).click();
    const review = page.getByRole('dialog', { name: 'Review and sign' });
    await review.getByRole('button', { name: /Sign note/ }).click();
    await expect(review).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Visit note' })).toBeVisible();
  });

  await test.step('doctor reads the AI draft to the end and approves it', async () => {
    const draft = page.getByRole('region', { name: 'AI draft sections' });
    await draft.focus();
    await page.keyboard.press('End');
    const approve = page.getByRole('button', { name: 'Approve' });
    await expect(approve).toBeEnabled();
    await approve.click();
    const confirm = page.getByRole('dialog', { name: 'Approve the summary?' });
    await confirm.getByRole('button', { name: 'Approve' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText(/AI-assisted · reviewed/).first()).toBeVisible();
  });

  await test.step('reception issues the invoice and records a partial payment', async () => {
    await signIn(page, 'reception1@medassist.dev');
    await page.goto(`${stack.baseURL}/reception/invoices`);
    await page.getByRole('main').getByLabel('Search', { exact: true }).fill(stack.patient.name);
    // The visit's draft (consultation + CBC) is the patient's only draft.
    const draftRow = page.getByRole('row', { name: new RegExp(`Draft.*${stack.patient.name}`) });
    await expect(draftRow).toHaveCount(1);
    await draftRow.getByRole('link', { name: 'Draft' }).click();
    await page.getByRole('button', { name: /issue invoice/i }).click();
    const issue = page.getByRole('dialog', { name: 'Issue this invoice?' });
    await issue.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(issue).toBeHidden();
    const invoiceHeading = page.getByRole('heading', { level: 1, name: /^INV-\d{4}-\d{6}$/ });
    await expect(invoiceHeading).toBeVisible();
    invoiceNumber = (await invoiceHeading.textContent())!.trim();
    await page.getByRole('button', { name: /record payment/i }).click();
    const payment = page.getByRole('dialog', { name: /^Record payment/ });
    await payment.getByLabel('Amount received').fill('500');
    await payment.getByLabel('Method').selectOption({ label: 'Cash' });
    await payment.getByRole('button', { name: 'Record payment' }).click();
    await expect(payment).toBeHidden();
    await expect(page.getByText('Paid ₹500.00 of ₹1,250.00')).toBeVisible();
    await expect(page.getByText('Partly paid').first()).toBeVisible();
  });
  await test.step('lab tech collects the sample and enters the results', async () => {
    await signIn(page, 'lab1@medassist.dev');
    await page.goto(`${stack.baseURL}/lab/worklist`);
    await page.getByRole('tab', { name: /^To collect/ }).click();
    const row = page.getByRole('row', { name: new RegExp(stack.patient.name) });
    await expect(row).toHaveCount(1);
    await row.getByRole('link', { name: /^LAB-\d{4}-\d{6}$/ }).click();
    await page.getByRole('button', { name: 'Collect sample' }).click();
    // Collecting opens the sample label to print; back to the order.
    await expect(page.getByRole('heading', { level: 1, name: 'Sample label' })).toBeVisible();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Start processing' }).click();
    const results: Record<string, string> = {
      Haemoglobin: '13.4',
      'RBC count': '4.6',
      'Packed cell volume (PCV)': '41',
      'Mean corpuscular volume (MCV)': '88',
      'Total WBC count': '7200',
      'Platelet count': '250000',
    };
    for (const [name, value] of Object.entries(results)) {
      await page.getByRole('textbox', { name, exact: true }).fill(value);
    }
    await page.getByRole('button', { name: 'Save CBC' }).click();
    await expect(page.getByText('Complete Blood Count: results saved')).toBeVisible();
    // Dual verification: whoever entered the results may not verify them.
    await expect(page.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  await test.step('a second lab tech verifies and releases', async () => {
    await signIn(page, 'lab2@medassist.dev');
    await page.goto(`${stack.baseURL}/lab/worklist`);
    await page.getByRole('tab', { name: /^Awaiting verification/ }).click();
    const row = page.getByRole('row', { name: new RegExp(stack.patient.name) });
    await row.getByRole('link', { name: /^LAB-\d{4}-\d{6}$/ }).click();
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Results verified')).toBeVisible();
    await page.getByRole('button', { name: 'Release' }).click();
    const release = page.getByRole('dialog', { name: 'Release these results?' });
    await release.getByRole('button', { name: 'Release' }).click();
    await expect(release).toBeHidden();
    await expect(page.getByText('Released').first()).toBeVisible();
  });

  await test.step('the patient sees the lab report and the invoice', async () => {
    await signIn(page, stack.patient.email);
    await page.goto(`${stack.baseURL}/patient/lab-reports`);
    const report = page.getByRole('row', {
      name: new RegExp(`Complete Blood Count.*${stack.doctor.name}`),
    });
    await report.getByRole('link', { name: clinicDay() }).click();
    await expect(page.getByRole('heading', { level: 1, name: /^Lab report/ })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'Haemoglobin' })).toBeVisible();
    await expect(page.getByText('13.4')).toBeVisible();

    await page.goto(`${stack.baseURL}/patient/invoices`);
    await page.getByRole('link', { name: invoiceNumber }).click();
    await expect(page.getByRole('heading', { level: 1, name: invoiceNumber })).toBeVisible();
    await expect(page.getByText('₹750.00').first()).toBeVisible();
  });

  await test.step('the patient opens "Explain in simple words"', async () => {
    await page.goto(`${stack.baseURL}/patient/prescriptions`);
    const rx = page.getByRole('row', { name: new RegExp(`${stack.doctor.name}.*Issued`) });
    await rx.getByRole('link', { name: clinicDay() }).click();
    await page.getByRole('button', { name: /Explain in simple words/ }).click();
    const panel = page.getByRole('region', { name: 'Explained in simple words' });
    await expect(panel.getByText('Your medicines')).toBeVisible();
    await expect(panel.getByText(/Paracetamol/).first()).toBeVisible();
    await expect(panel.getByText('When to contact the clinic')).toBeVisible();
    await expect(panel.getByText(/does not replace your doctor’s advice/)).toBeVisible();
  });
});
