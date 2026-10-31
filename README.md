# NTU TPU Portal

Static quota dashboard for GitHub Pages, using Google sign-in and Firestore on a separate Firebase Spark project.

- Members read their own allocation only.
- Administrators create members, grant credits and inspect immutable grant history.
- Grants use Firestore transactions with operation IDs; retries do not grant twice.
- Client code cannot update settled costs, reservations or administrator roles.
- TPU types, zones, prices and provisioning status appear on the member dashboard.

The dashboard does not currently provision TPUs or reconcile billing. A recorded allocation is not a Google Cloud Billing spend cap. The compute controller must be deployed and tested separately before enabling self-service jobs.

The frontend includes an optional TPU request and settlement interface. Its connection remains disabled (`backendUrl = null`). The controller implementation and deployment review are kept privately and are not part of this public repository. No cloud service or recurring scheduler is deployed by the Pages workflow.

## Local preview

```sh
npm install
npm run preview
```

Open `http://localhost:4173/`. Design previews with synthetic data: `?preview=admin` and `?preview=member`. Preview mode never reads or writes cloud data.

`web/firebase-config.js` contains public Firebase Web app identifiers, not a service-account credential. No GCP keys or OAuth secrets belong in this repository.

## Tests

```sh
npm test
npm run test:rules
```

Rules tests use the local Firestore emulator and the `demo-ntu-tpu` project. They do not deploy or change cloud resources. The pinned development CLI currently runs on Java 17; newer CLI majors may require Java 21.

## Deployment

The Pages workflow publishes only `web/`. Select **GitHub Actions** as the Pages source in repository Settings → Pages. Add the exact Pages hostname to Firebase Authentication → Settings → Authorized domains.

Publish the reviewed `firestore.rules` through Firebase Console. Bootstrap `admins/{verified Firebase UID}` through an existing project owner's Console session, with `email` matching the verified Google email and `enabled: true`. Client rules do not allow creating or editing admin documents.

Member records are `members/{lowercase verified Google email}`. Authenticated users read only the exact record matching the Google token email; they cannot enumerate the collection. Creating a Firebase Authentication identity alone grants no quota or GCP IAM access.

The private operational guide and actual member data are excluded from source control. Do not upload credentials, billing exports, personal allocation lists or the private guide.
