import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function makeResumePdf() {
  const lines = [
    'Jordan Lee',
    'jordan.e2e@example.test',
    'Education',
    'B.Tech Computer Science, Example University, graduating 2026',
    'Skills',
    'Python, SQL, React, Git, Algorithms',
    'Projects',
    'Campus dashboard built with Python and SQL; implemented data validation and tests; reduced review time by 25% for 120 records.',
    'The React reporting project is deployed at https://example.test/demo.',
  ];
  const commands = lines.flatMap((line, index) => [
    index === 0 ? 'BT /F1 11 Tf 48 744 Td' : '0 -18 Td',
    `(${line.replace(/[\\()]/g, '\\$&')}) Tj`,
  ]).join('\n');
  const stream = `${commands}\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function runQuestionStep(questionNumber: number, step: string, startedAt: number, action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const elapsed = Date.now() - startedAt;
    console.error(`[e2e] Question ${questionNumber} step "${step}" failed after ${elapsed}ms`);
    throw new Error(`[e2e] Question ${questionNumber} step "${step}" failed after ${elapsed}ms: ${message}`, { cause: error });
  }
}

test('candidate completes registration through interview report using the test database', async ({ page, request }) => {
  test.setTimeout(300_000);
  const email = `candidate-${randomUUID()}@example.test`;
  let accessToken = '';

  try {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByLabel('Name').fill('Jordan Lee');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill('CampusReady-2026!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Verify email' }).click();

    const loginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/auth/login' && response.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill('CampusReady-2026!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    accessToken = (await loginResponse.json()).accessToken as string;
    await expect(page.getByRole('button', { name: 'My resume' })).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: 'My resume' }).click();
    const resumeFixturePath = fileURLToPath(new URL('./fixtures/candidate-resume.pdf', import.meta.url));
    const generatedResume = {
      name: 'Jordan-Lee-Resume.pdf',
      mimeType: 'application/pdf',
      buffer: makeResumePdf(),
    };
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(existsSync(resumeFixturePath) ? resumeFixturePath : generatedResume);
    const analysisResponsePromise = page.waitForResponse((response) =>
      /\/api\/v1\/resumes\/[0-9a-f-]+\/analyze$/.test(new URL(response.url()).pathname)
      && response.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Upload and analyze' }).click();
    const analysisResponse = await analysisResponsePromise;
    expect(analysisResponse.status()).toBe(201);
    const analysis = await analysisResponse.json();
    expect(analysis.limitedAnalysis, analysis.reason ? `limitedAnalysis reason: ${analysis.reason}` : 'limitedAnalysis reason: unknown').toBe(false);
    expect(analysis.topRoles.length).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { name: 'Resume health' })).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: 'Role matches' }).click();
    await expect(page.getByRole('heading', { name: 'Find the roles within reach.' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('YOUR TOP MATCHES')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.role-match-card').first()).toBeVisible({ timeout: 120_000 });

    await page.getByRole('button', { name: 'Mock tests' }).click();
    await page.getByRole('button', { name: 'Start test' }).first().click();
    const questionHeading = page.locator('.assessment-question-heading');
    await expect(questionHeading).toBeVisible({ timeout: 120_000 });
    const headingText = await questionHeading.innerText();
    const questionProgress = headingText.match(/QUESTION\s+(\d+)\s+OF\s+(\d+)/i);
    const firstQuestionNumber = Number(questionProgress?.[1]);
    const questionCount = Number(questionProgress?.[2]);
    expect(firstQuestionNumber).toBe(1);
    expect(questionCount).toBeGreaterThan(0);
    for (let index = 0; index < questionCount; index += 1) {
      const questionNumber = index + 1;
      const startedAt = Date.now();
      console.info(`[e2e] Question ${questionNumber}/${questionCount} started`);

      await runQuestionStep(questionNumber, 'save answer', startedAt, async () => {
        const saveResponsePromise = page.waitForResponse((response) =>
          new URL(response.url()).pathname.endsWith('/answers') && response.request().method() === 'PUT', { timeout: 30_000 });
        const [saveResponse] = await Promise.all([
          saveResponsePromise,
          page.locator('.assessment-option').first().click({ timeout: 30_000 }),
        ]);
        if (!saveResponse.ok()) throw new Error(`PUT /answers returned ${saveResponse.status()}`);
      });

      if (index < questionCount - 1) {
        await runQuestionStep(questionNumber, 'advance to next question', startedAt, async () => {
          await page.getByRole('button', { name: 'Next' }).click({ timeout: 30_000 });
          await expect(questionHeading).toContainText(
            new RegExp(`QUESTION\\s+${questionNumber + 1}\\s+OF\\s+${questionCount}`, 'i'),
            { timeout: 30_000 },
          );
        });
      }

      console.info(`[e2e] Question ${questionNumber}/${questionCount} completed in ${Date.now() - startedAt}ms`);
    }
    const submitStartedAt = Date.now();
    await runQuestionStep(questionCount, 'verify answered palette', submitStartedAt, async () => {
      await expect(page.locator('.assessment-palette-panel').getByText(`${questionCount}/${questionCount} answered`, { exact: true })).toBeVisible({ timeout: 30_000 });
    });
    await runQuestionStep(questionCount, 'submit assessment', submitStartedAt, async () => {
      const submitResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/submit') && response.request().method() === 'POST', { timeout: 120_000 });
      await page.getByRole('button', { name: 'Submit test', exact: true }).click();
      const submitResponse = await submitResponsePromise;
      if (!submitResponse.ok()) throw new Error(`POST /submit returned ${submitResponse.status()}`);
      await expect(page.getByText('ASSESSMENT REPORT')).toBeVisible({ timeout: 120_000 });
    });

    await page.getByRole('button', { name: 'Mock interviews' }).click();
    const interviewCreatedPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/interviews' && response.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Start a text interview' }).click();
    const interviewCreated = await interviewCreatedPromise;
    expect(interviewCreated.status()).toBe(201);
    const { questionCount: TOTAL_INTERVIEW_QUESTIONS } = await interviewCreated.json() as { questionCount: number };
    expect(TOTAL_INTERVIEW_QUESTIONS).toBeGreaterThan(0);

    for (let index = 0; index < TOTAL_INTERVIEW_QUESTIONS; index += 1) {
      const questionNumber = index + 1;
      const questionHeading = page.getByRole('heading', { level: 2 }).last();
      await expect(questionHeading).toBeVisible({ timeout: 30_000 });
      const currentQuestion = (await questionHeading.innerText()).trim();
      const responseText = 'I designed and implemented the change, tested it with representative data, and verified the improved result.';

      await page.getByLabel('Your response').fill(responseText);

      const answerResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/answer') && response.request().method() === 'POST', { timeout: 120_000 });

      const saveButton = page.getByRole('button', { name: 'Save & continue' });
      await expect(saveButton).toBeEnabled({ timeout: 30_000 });
      await saveButton.click();

      const answerResponse = await answerResponsePromise;
      expect(answerResponse.status()).toBe(201);

      if (questionNumber < TOTAL_INTERVIEW_QUESTIONS) {
        await expect(page.getByRole('heading', { name: currentQuestion, exact: true })).toHaveCount(0, { timeout: 30_000 });
      }

      console.info(`[e2e] Question ${questionNumber}/${TOTAL_INTERVIEW_QUESTIONS} completed`);
    }

    await expect(page.getByRole('button', { name: 'Build my report' })).toBeVisible({ timeout: 60_000 });

    page.on('response', async (response) => {
      const url = response.url();
      if (!['/finish', '/report', '/auth/refresh', '/auth/me'].some((path) => url.includes(path))) return;
      const method = response.request().method();
      const status = response.status();
      console.info(`[e2e] response ${method} ${url} ${status}`);
      if (status >= 400) {
        try {
          console.error(`[e2e] response body ${method} ${url}: ${await response.text()}`);
        } catch (error) {
          console.error(`[e2e] response body unavailable ${method} ${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });
    page.on('framenavigated', (frame) => {
      console.info(`[e2e] frame navigated ${frame.url()}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[e2e] console error ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      console.error(`[e2e] page error ${error.message}`);
    });
    page.on('requestfailed', (request) => {
      console.error(`[e2e] request failed ${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`);
    });

    await page.getByRole('button', { name: 'Build my report' }).click();
    await expect(page.getByRole('heading', { name: 'Evidence, not just a score' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Rule-based estimate')).toBeVisible({ timeout: 120_000 });

    const probabilityConsoleErrors: string[] = [];
    const probabilityPageErrors: string[] = [];
    const onProbabilityConsole = (message: import('@playwright/test').ConsoleMessage) => {
      if (message.type() === 'error') probabilityConsoleErrors.push(message.text());
    };
    const onProbabilityPageError = (error: Error) => probabilityPageErrors.push(error.message);
    page.on('console', onProbabilityConsole);
    page.on('pageerror', onProbabilityPageError);
    try {
      const probabilityResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/me/placement-probability'
        && response.request().method() === 'GET', { timeout: 60_000 });
      await page.getByRole('button', { name: 'Placement probability' }).click();
      const probabilityResponse = await probabilityResponsePromise;
      expect(probabilityResponse.status()).toBe(200);
      const probability = await probabilityResponse.json();
      expect(typeof probability.probability).toBe('number');
      expect(typeof probability.weightedScore).toBe('number');
      expect(typeof probability.dataPoints).toBe('number');
      for (const value of Object.values(probability.components) as Array<number | null>) {
        expect(value === null || typeof value === 'number').toBe(true);
      }

      await expect(page.getByText(String(probability.probability), { exact: true }).first()).toBeVisible();
      await expect(page.getByText(`${probability.confidence} confidence`, { exact: true })).toBeVisible();
      await expect(page.getByText(new RegExp(`${probability.dataPoints} of 5 signals available`))).toBeVisible();
      await expect(page.getByText('RULE-BASED PLACEMENT ESTIMATE', { exact: true })).toBeVisible();

      const simulationResponsePromise = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/me/placement-probability/simulate'
        && response.request().method() === 'POST', { timeout: 60_000 });
      await page.getByRole('button', { name: 'Stretch' }).click();
      const simulationResponse = await simulationResponsePromise;
      expect(simulationResponse.status()).toBe(200);
      const simulation = await simulationResponse.json();
      expect(typeof simulation.delta).toBe('number');
      expect(simulation.before.probability).toBe(probability.probability);
      expect(simulation.after.probability).toBeCloseTo(simulation.before.probability + simulation.delta, 1);
      await expect(page.getByText(String(simulation.after.probability), { exact: true }).first()).toBeVisible();
      const deltaLabel = `${simulation.delta >= 0 ? '+' : ''}${simulation.delta.toFixed(1)} pts vs current`;
      await expect(page.getByText(deltaLabel, { exact: true })).toBeVisible();
      console.info(`[e2e] Placement probability ${probability.probability} -> ${simulation.after.probability} (${deltaLabel})`);
    } finally {
      page.off('console', onProbabilityConsole);
      page.off('pageerror', onProbabilityPageError);
    }
    expect(probabilityConsoleErrors, `probability console errors: ${probabilityConsoleErrors.join('; ')}`).toEqual([]);
    expect(probabilityPageErrors, `probability page errors: ${probabilityPageErrors.join('; ')}`).toEqual([]);
  } finally {
    if (accessToken) {
      try {
        const cleanup = await request.delete('http://127.0.0.1:4001/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cleanup.status() !== 204 && cleanup.status() !== 404) {
          console.warn(`Cleanup status was ${cleanup.status()} for ${email}`);
        }
      } catch (error) {
        console.warn(`Cleanup failed for ${email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
});