# AR Automation v2 Usage Guide

This guide explains the current operator workflow for A/R automation v2, with the focus on what a person needs to do at each step.

## What This Automation Does

The automation helps turn an aging A/R workbook into a review sheet and then into Google Doc email text for overdue follow-up.

For the Google Docs flow, the process is:

1. Upload the latest aging A/R Excel file.
2. Wait for Step 1 to create the review sheet.
3. Review the projects that should be included.
4. Submit the review sheet link into the Step 2 Google Docs form.
5. Open the generated Google Doc output and use it to send the actual emails.

The workflows involved are:

- `AR Automation v2 - Step 1 - Intake XLSX from Drive`
- `AR Automation v2 - Step 2 - Create Google Docs from Review Sheet`

## What You Need Before Starting

Before you begin, make sure you have:

- the latest aging A/R report exported as an `.xlsx` file
- access to the Google Drive intake folder used by Step 1
- access to the email inbox that receives the Step 1 review-sheet notification
- the Step 2 Google Docs form link

Important:

- invoice PDFs are still attached manually after the Google Doc email text is created
- the automation creates email text, but a person still reviews it and sends the final email

## Step 1: Upload The Aging Report

Step 1 begins when the operator uploads the latest aging workbook to the Drive intake folder.

1. Export the current aging A/R report as an `.xlsx` file.
2. Open the Google Drive intake folder.
3. Click `+ New`.
4. Click `File upload`.
5. Select the aging `.xlsx` file from your computer.
6. Wait for the upload to finish.

After that, the automation should:

- start automatically
- read the uploaded workbook
- create a new Google review sheet
- send an email with the review sheet link and the Step 2 Google Docs form link

## What The Operator Does After Step 1

When the Step 1 email arrives:

1. Open the email.
2. Confirm the source workbook name and the aging date look correct.
3. Click the review spreadsheet link.
4. Keep the Step 2 form link available for later.

The Step 1 email is the handoff from intake to review. If that email does not arrive, the operator should stop there and troubleshoot before moving on.

## Review The Generated Sheet

Open the Google review sheet created by Step 1.

The sheet includes these tabs:

- `Review Projects`
- `Parsed Invoices`
- `Workflow Metadata`

Only `Review Projects` should be edited.

Each row in `Review Projects` represents one project selected for possible follow-up.

The operator should review each row and:

- leave `Send` as `Yes` for projects that should stay in the outbound set
- change `Send` for any project that should not be included
- add instructions in `Note For Distribution` when the outbound email should include human guidance or context

Do not edit:

- `Parsed Invoices`
- `Workflow Metadata`

## Step 2: Create The Google Doc Email Text

After review is complete:

1. Copy the URL of the review spreadsheet.
2. Open the Step 2 Google Docs form link from the Step 1 email.
3. Paste the review spreadsheet URL into the form.
4. Submit the form.

After submission, the automation begins building the Google Doc output from the rows still marked to send.

## What The Operator Does After Google Docs Are Created

When the Google Docs step finishes:

1. Open the notification email that lists the created Google Doc output.
2. Open the generated Google Doc.
3. Review the subject line and the email wording before sending anything.
4. Check that the `Note For Distribution` guidance appears the way you expect.
5. Attach the invoice PDFs manually.
6. Copy the email text into the final outbound email or otherwise use the Google Doc as the sending draft source.
7. Make any final judgment edits that are needed before sending to the client.

The automation prepares the email text. A person still owns the final review, attachments, and send decision.

## What To Expect In The Output

The Google Doc output should include:

- generated A/R follow-up email text based on the reviewed projects
- project and invoice details for the selected rows
- any `Note For Distribution` content entered during review

The operator should treat the output as a prepared draft, not as a send-without-review result.

## Troubleshooting

If nothing happens after uploading the file:

- confirm the file was uploaded as `.xlsx`
- confirm the file was uploaded to the correct Google Drive intake folder
- confirm the upload finished successfully
- let the workflow owner know Step 1 may not be active

If the Step 1 email does not arrive:

- check whether the workbook upload used the correct file
- confirm the inbox and spam folder for the review notification
- let the workflow owner know the Step 1 notification may have failed

If the review sheet looks wrong:

- review the `Review Projects` tab first
- confirm the uploaded aging report was the correct export
- confirm the projects shown are the ones that should be considered for follow-up

If the Google Doc output is missing expected items:

- confirm the correct review sheet link was submitted into Step 2
- confirm the right rows were still marked in `Send`
- confirm `Note For Distribution` was entered on the intended rows

If the generated email text still needs changes:

- make the human edits before sending
- attach invoice PDFs manually
- pause and ask the workflow owner if the issue appears to be a recurring automation problem

## Operator Notes

- `Raw Project Number` is used internally for matching and support tabs
- displayed `Project Number` values may remove a leading `MH` for readability
- raw A/R comments are review context, not guaranteed client-facing text
- the final send step remains manual even when the Google Doc output is generated successfully
