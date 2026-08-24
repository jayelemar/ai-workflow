# iOS Staging Deployment to TestFlight

## Purpose

Deploy the latest `frontend` changes from the remote `staging` branch to the
internal TestFlight group **Myuse Testers** by using the existing Xcode Cloud
workflow **Staging Release**.

This is the supported deployment path. A build uploaded manually from Xcode is
not eligible for the **Myuse Testers** group while that group is configured to
accept Xcode Cloud builds only.

## Ownership and trigger

- Owner: Myuse iOS release operator with App Store Connect Admin or App Manager
  access.
- Trigger: approved frontend changes have been merged into `staging` and are
  ready for internal testing.
- Platform: iOS only.
- Success signal: the new build shows **Testing** under TestFlight > Myuse
  Testers.

## Prerequisites

- Access to the Myuse Limited team in App Store Connect.
- Permission to start Xcode Cloud builds and manage TestFlight builds.
- The intended changes are committed and pushed to `origin/staging`.
- The existing Xcode Cloud workflow **Staging Release** is active.
- `frontend/ios/ci_scripts/ci_post_clone.sh` remains available so Xcode Cloud
  can install Node, Yarn dependencies, and CocoaPods dependencies.

## 1. Verify the deployment source

From the repository root:

```bash
cd frontend
rtk git switch staging
rtk git pull --ff-only origin staging
rtk git status --short --branch
rtk git log -1 --oneline
```

Expected:

- The active branch is `staging`.
- `staging` matches `origin/staging`.
- There are no staged or unstaged files.
- The latest commit is the commit intended for TestFlight.

Do not deploy uncommitted local changes. Xcode Cloud checks out the remote
branch, so local-only changes are not included.

## 2. Prevent a build-number collision

1. Open App Store Connect > Myuse Ltd. > TestFlight > iOS.
2. Find the highest build number under the current app version.
3. Open Xcode Cloud > Settings > Build Number.
4. Confirm **Next Build Number** is greater than every existing TestFlight build
   for that app version.
5. If needed, click **Edit**, enter the next unused integer, and save.

Example: if TestFlight already contains builds 61, 62, and 63, set the next
Xcode Cloud build number to 64.

Xcode Cloud assigns its build number to the archived app. Do not edit
`CURRENT_PROJECT_VERSION` or `CFBundleVersion` locally merely to start an Xcode
Cloud deployment. After a successful cloud build, Xcode Cloud advances its next
build number automatically.

## 3. Start the Xcode Cloud build

1. Open App Store Connect > Myuse Ltd. > Xcode Cloud > Builds.
2. Click **Start Build**.
3. Select the **Staging Release** workflow.
4. Select **Branches**.
5. If the branch list is empty, clear the **Mine** checkbox. This filter can be
   empty when App Store Connect cannot associate the current user with a GitHub
   account.
6. Select `staging`.
7. Confirm the displayed commit matches the commit verified in step 1.
8. Click **Start Build**.

Expected:

- The build number is the unused number selected in step 2.
- The workflow is **Staging Release**.
- The source branch is `staging`.
- The last commit is the intended remote commit.

## 4. Monitor the archive

Normal states include:

- Queued
- Waiting for an available environment
- Setting up environment
- Archive - iOS: In Progress
- Archive - iOS: Succeeded

Warnings from dependencies do not by themselves mean the build failed. Treat a
red failed action as a failure and inspect that action's logs before retrying.
Do not repeatedly start builds while one is queued or running.

## 5. Complete export compliance

After the archive succeeds, open TestFlight > iOS and locate the new build.

If its status is **Missing Compliance**:

1. Click **Manage** beside the new build.
2. For the currently verified app behavior, select **None of the algorithms
   mentioned above**.
3. Click **Save**.
4. Wait for the status to change to **Ready to Test**.

This answer is based on the app currently relying on Apple/network security and
not implementing proprietary or standalone encryption. Reassess the answer if
the app later adds custom cryptography or a library that implements non-exempt
encryption.

Current limitation: the project does not declare
`ITSAppUsesNonExemptEncryption = NO`, so App Store Connect asks this question
for each new build. Add that declaration in a separately reviewed source change
to remove the repeated prompt.

## 6. Add the build to internal testers

1. Open TestFlight > Myuse Testers.
2. Select the **Builds** tab.
3. Click the blue add button beside **Builds**.
4. Select the new Xcode Cloud build.
5. Click **Add**.

Expected:

- The build appears at the top of the group's build list.
- Its status is **Testing**.
- The group still contains the intended four internal testers.

Testers can then refresh the TestFlight app and install or update to the new
build.

## 7. Final verification

- Confirm the TestFlight version and build number are the expected values.
- Confirm the status is **Testing**, not merely **Ready to Test**.
- Confirm the build is listed under **Myuse Testers**.
- Confirm at least one internal tester can install and launch it.
- Run `rtk git status --short --branch` in `frontend/` and confirm deployment
  did not leave local build-number edits behind.

## Failure and recovery guide

### Branch list is empty

Clear the **Mine** checkbox in the Start Build dialog. Relink the GitHub account
later if personalized build filtering or notifications are required.

### Duplicate build number

Do not retry with the same already-uploaded number. Open Xcode Cloud > Settings
> Build Number, set the next number above the highest TestFlight build, and
start a new build.

### Build fails during Archive - iOS

Open the failed Archive action and inspect its logs. Fix and push the failure to
`staging`, then start a new cloud build. Do not hide the failure by switching to
a manual Xcode upload.

### Build is Ready to Test but not Testing

The build has not been assigned to the tester group. Add it through Myuse
Testers > Builds using the blue add button.

### Build cannot be selected for Myuse Testers

Verify it was created by the **Staging Release** Xcode Cloud workflow. Manual
Xcode uploads are not selectable while this group's automatic distribution
setting accepts Xcode Cloud builds only.

### Roll back a bad TestFlight build

1. Open TestFlight > Myuse Testers > Builds.
2. Remove the bad build from the group.
3. Confirm the prior known-good build remains **Testing** and available.
4. Fix the problem on a branch, merge it into `staging`, and deploy a new Xcode
   Cloud build with a new build number.

Removing a build from the group limits tester access; it does not rewrite or
delete the uploaded artifact.

## References

- [Configuring an Xcode Cloud workflow](https://developer.apple.com/documentation/xcode/configuring-your-first-xcode-cloud-workflow)
- [Setting the next Xcode Cloud build number](https://developer.apple.com/documentation/xcode/setting-the-next-build-number-for-xcode-cloud-builds)
- [App export compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance)
- [`ITSAppUsesNonExemptEncryption`](https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption)
