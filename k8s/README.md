# Kubernetes Deployment — AI-Enhanced Climate Data Management System

Deploys the AI-Enhanced CDMS onto an **OpenStack Magnum** Kubernetes cluster.
Namespace: `climate-ai`

---

## 1. Prerequisites

| Tool | Purpose | Install |
|---|---|---|
| `kubectl` ≥ 1.28 | Cluster control | [docs.k8s.io](https://kubernetes.io/docs/tasks/tools/) |
| `openstack` CLI | Magnum cluster management | `pip install python-openstackclient python-magnumclient` |
| Access to OpenStack project | Create cluster, Cinder volumes, Octavia LB | Provided by cloud admin |
| Container registry | Push custom images | e.g. Harbor, DockerHub, GHCR |

Authenticate to OpenStack before running any commands:

```bash
source ~/openstack-rc.sh   # download from OpenStack dashboard → Identity → RC file
openstack token issue       # verify auth works
```

---

## 2. Create Magnum Cluster

```bash
# Create the cluster (takes 10–15 minutes)
openstack coe cluster create climate-ai-cluster \
  --cluster-template k8s-v1.28 \
  --master-count 1 \
  --node-count 3 \
  --flavor m1.large \
  --master-flavor m1.medium

# Download kubeconfig once cluster status is CREATE_COMPLETE
openstack coe cluster config climate-ai-cluster > ~/.kube/config
kubectl get nodes   # verify
```

---

## 3. Create Secrets Safely

**Never** apply `secret.yaml` with placeholder values to a production cluster.
Use one of these approaches instead:

```bash
# Option A — from your local .env file (recommended)
kubectl create secret generic climate-secrets \
  --from-env-file=back-end/api/.env \
  -n climate-ai

# Option B — explicit literals
kubectl create secret generic climate-secrets \
  --from-literal=GROQ_API_KEY='gsk_...' \
  --from-literal=DB_ENCRYPTION_KEY='...' \
  --from-literal=DB_PASSWORD='...' \
  --from-literal=SESSION_SECRET='...' \
  -n climate-ai
```

---

## 4. Apply All Manifests

```bash
# Apply in dependency order (namespace first, then everything else)
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/cronjob.yaml
```

Or all at once (after the namespace exists):

```bash
kubectl apply -f k8s/
```

---

## 5. Verify Deployment

```bash
# All resources in the namespace
kubectl get all -n climate-ai

# Check pod readiness (wait for 2/2 Running)
kubectl get pods -n climate-ai -w

# Get the frontend external IP (OpenStack Octavia LB — may take 2–3 min)
kubectl get svc climate-ai-frontend -n climate-ai

# Check the PVC is Bound
kubectl get pvc -n climate-ai

# Describe a failing pod for events/errors
kubectl describe pod <pod-name> -n climate-ai
```

---

## 6. Trigger a Manual Pipeline Run

The LMS AI pipeline runs automatically at 02:00 UTC. To trigger immediately:

```bash
kubectl create job \
  --from=cronjob/lms-ai-pipeline \
  lms-ai-manual-$(date +%s) \
  -n climate-ai

# Watch it run
kubectl get jobs -n climate-ai -w
```

---

## 7. Check Logs

```bash
# Backend API logs (stream)
kubectl logs -f deployment/climate-ai-api -n climate-ai

# Frontend logs
kubectl logs -f deployment/climate-ai-frontend -n climate-ai

# Most recent pipeline job logs
kubectl logs -l app=lms-ai-pipeline -n climate-ai --tail=200

# Tail API logs for a specific pod
kubectl logs <pod-name> -n climate-ai --since=1h
```

---

## 8. Quick-Start — Zero to Running in 5 Commands

```bash
# 1. Authenticate and get kubeconfig
openstack coe cluster config climate-ai-cluster > ~/.kube/config

# 2. Create namespace and non-secret config
kubectl apply -f k8s/namespace.yaml -f k8s/configmap.yaml -f k8s/pvc.yaml

# 3. Create secrets from .env (never commit this to git)
kubectl create secret generic climate-secrets --from-env-file=back-end/api/.env -n climate-ai

# 4. Deploy everything
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/cronjob.yaml

# 5. Watch pods come up and grab the public IP
kubectl get all -n climate-ai
```

---

## Image Build Reference

Before deploying, build and push the three images:

```bash
# Backend API
docker build -t your-registry/climate-ai-api:latest back-end/api/
docker push your-registry/climate-ai-api:latest

# Frontend (Angular/nginx)
docker build -t your-registry/climate-ai-frontend:latest front-end/pwa/
docker push your-registry/climate-ai-frontend:latest

# LMS AI pipeline (Python — build from aws-ingestion-layer)
docker build -t your-registry/climate-ai-pipeline:latest \
  front-end/pwa/aws-ingestion-layer/
docker push your-registry/climate-ai-pipeline:latest
```

Update the `image:` fields in `deployment.yaml` and `cronjob.yaml` to match your registry prefix.

---

## ConfigMap vs Secret Reference

| Variable | Location | Description |
|---|---|---|
| `NODE_ENV` | ConfigMap | `production` |
| `DB_HOST` | ConfigMap | Postgres service name (`climate-ai-postgres`) |
| `DB_PORT` | ConfigMap | `5432` |
| `DB_NAME` | ConfigMap | `climsoft` |
| `DB_USERNAME` | ConfigMap | `postgres` |
| `ALLOWED_ORIGINS` | ConfigMap | Comma-separated CORS origins |
| `LMS_GENAI_PROVIDER` | ConfigMap | `groq` |
| `GROQ_MODEL` | ConfigMap | `llama-3.3-70b-versatile` |
| `GROQ_API_KEY` | **Secret** | Groq console API key |
| `DB_ENCRYPTION_KEY` | **Secret** | 32-byte AES key for email column encryption |
| `DB_PASSWORD` | **Secret** | PostgreSQL password |
| `SESSION_SECRET` | **Secret** | Express-session signing secret |
