#!/usr/bin/env bash
# Install the NEW Jenkins job structure (PRJ-012 #60) — folders + per-service deploy
# jobs, per knowledge/deployment/jenkins-job-organization.md. Idempotent + additive.
# Everything nests under a single parent folder ($PARENT=svm-prj-work) so it does not
# crowd the shared Jenkins root: ${PARENT}/{build/{image,lib},deploy/<svc>/<env>,ops/<svc>}.
#
# Writes config.xml into $JENKINS_HOME via the gyan-workspace -> chinhut -> jenkins path,
# then reloads. Run from the workspace repo. Reads no secrets.
#
# Env mapping (Jenkinsfiles' DEPLOY_ENV): dev->development, uat->staging, prod->production.
set -euo pipefail
JH=/var/lib/jenkins
# All governance folders/jobs nest under a single parent folder so they don't crowd the
# Jenkins root (which is shared with other teams: Libraries, BIDA-ERP, mda, ...).
PARENT=svm-prj-work
JOBROOT="$JH/jobs/$PARENT/jobs"
SSH() { docker exec gyan-workspace ssh -o ConnectTimeout=10 chinhut "sudo -n -u jenkins bash -c $(printf '%q' "$*")"; }
PUT() { docker exec -i gyan-workspace ssh -o ConnectTimeout=10 chinhut "sudo -n -u jenkins tee '$1' >/dev/null"; }

folder_xml() {  # $1 = description. Canonical Cloudbees Folder (matches an existing working
  # folder); the AllView owner reference is an object-graph path (fixed depth) so it is
  # correct for top-level AND nested folders. Needs folderViews + icon to load.
  cat <<EOF
<?xml version='1.1' encoding='UTF-8'?>
<com.cloudbees.hudson.plugins.folder.Folder>
  <description>$1</description>
  <properties/>
  <folderViews class="com.cloudbees.hudson.plugins.folder.views.DefaultFolderViewHolder">
    <views>
      <hudson.model.AllView>
        <owner class="com.cloudbees.hudson.plugins.folder.Folder" reference="../../../.."/>
        <name>All</name>
        <filterExecutors>false</filterExecutors>
        <filterQueue>false</filterQueue>
        <properties class="hudson.model.View\$PropertyList"/>
      </hudson.model.AllView>
    </views>
    <tabBar class="hudson.views.DefaultViewsTabBar"/>
  </folderViews>
  <healthMetrics/>
  <icon class="com.cloudbees.hudson.plugins.folder.icons.StockFolderIcon"/>
</com.cloudbees.hudson.plugins.folder.Folder>
EOF
}

# deploy job (CpsScmFlowDefinition). $1=desc $2=repo $3=scriptPath $4=deploy_env(staging|production) $5=extra_params_xml $6=agent_label_override
deploy_job_xml() {
  # Per-env deploy agents ($4 = env): dev → chinhut (dev host + reverse proxy),
  # uat → indiranagar (label 'uat'), prod → svm-iam-deploy (hazratganj).
  local agent_label='svm-iam-deploy'
  [ "$4" = development ] && agent_label='chinhut'
  [ "$4" = staging ] && agent_label='uat'
  # Optional override ($6): a service whose envs all share ONE host (e.g. knowledge —
  # dev/uat/prod colocate on chinhut, PRJ-014 DEC-003) pins the same label for every env.
  [ -n "${6:-}" ] && agent_label="$6"
  # Each env deploys from ITS OWN env branch (prod must not depend on dev):
  # development→dev, staging→uat, production→prod. (Revised build/promote model.)
  local branch='prod'
  [ "$4" = development ] && branch='dev'
  [ "$4" = staging ] && branch='uat'
  cat <<EOF
<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>$1</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty><abortPrevious>false</abortPrevious></org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty>
    <hudson.model.ParametersDefinitionProperty>
      <parameterDefinitions>
        <hudson.model.StringParameterDefinition><name>AGENT_LABEL</name><defaultValue>${agent_label}</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>
        <hudson.model.ChoiceParameterDefinition><name>DEPLOY_ENV</name><choices><string>$4</string><string></string><string>staging</string><string>production</string></choices></hudson.model.ChoiceParameterDefinition>
        <hudson.model.BooleanParameterDefinition><name>SKIP_PROD_APPROVAL</name><defaultValue>false</defaultValue></hudson.model.BooleanParameterDefinition>
$5
      </parameterDefinitions>
    </hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>$2</url><credentialsId>jenkins-chinhut</credentialsId></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs>
      <branches><hudson.plugins.git.BranchSpec><name>*/${branch}</name></hudson.plugins.git.BranchSpec></branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/>
    </scm>
    <scriptPath>$3</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
EOF
}

# Build job (CpsScmFlowDefinition) — builds ONE immutable :sha artifact from the
# BUILD_BRANCH param (dev|uat|prod), so each env builds from its OWN branch and
# prod never depends on dev. $1=desc $2=repo $3=scriptPath
build_job_xml() {
  cat <<EOF
<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>$1</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty><abortPrevious>false</abortPrevious></org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty>
    <hudson.model.ParametersDefinitionProperty><parameterDefinitions>
      <hudson.model.StringParameterDefinition><name>AGENT_LABEL</name><defaultValue>svm-iam-deploy</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>
      <hudson.model.StringParameterDefinition><name>BUILD_BRANCH</name><defaultValue>dev</defaultValue><description>Env branch to build the immutable artifact from (dev|uat|prod). Promotion builds from the target env's branch — prod never depends on dev.</description><trim>false</trim></hudson.model.StringParameterDefinition>
    </parameterDefinitions></hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>$2</url><credentialsId>jenkins-chinhut</credentialsId></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs>
      <branches><hudson.plugins.git.BranchSpec><name>*/\${BUILD_BRANCH}</name></hudson.plugins.git.BranchSpec></branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/>
    </scm>
    <scriptPath>$3</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
EOF
}

# Lib publish job. $1=desc $2=repo $3=scriptPath $4=LIB_DIR $5=PUBLISH_DIR
lib_job_xml() {
  cat <<EOF
<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <description>$1</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    <org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty><abortPrevious>false</abortPrevious></org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty>
    <hudson.model.ParametersDefinitionProperty><parameterDefinitions>
      <hudson.model.StringParameterDefinition><name>AGENT_LABEL</name><defaultValue>svm-iam-deploy</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>
      <hudson.model.StringParameterDefinition><name>LIB_DIR</name><defaultValue>$4</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>
      <hudson.model.StringParameterDefinition><name>PUBLISH_DIR</name><defaultValue>$5</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>
    </parameterDefinitions></hudson.model.ParametersDefinitionProperty>
  </properties>
  <definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>$2</url><credentialsId>jenkins-chinhut</credentialsId></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs>
      <branches><hudson.plugins.git.BranchSpec><name>*/dev</name></hudson.plugins.git.BranchSpec></branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations><submoduleCfg class="empty-list"/><extensions/>
    </scm>
    <scriptPath>$3</scriptPath>
    <lightweight>true</lightweight>
  </definition>
  <triggers/>
  <disabled>false</disabled>
</flow-definition>
EOF
}

R911=git@github.com:Svayamtech/911-SVM-LIB-SVC.git
R912=git@github.com:Svayamtech/912-SVM-LIB-UI.git
PORTAL_PARAMS_UAT='<hudson.model.StringParameterDefinition><name>PORTAL_REPO</name><defaultValue>git@github.com:Svayamtech/912-SVM-LIB-UI.git</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition><hudson.model.StringParameterDefinition><name>PORTAL_BRANCH</name><defaultValue>uat</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>'
PORTAL_PARAMS_PROD='<hudson.model.StringParameterDefinition><name>PORTAL_REPO</name><defaultValue>git@github.com:Svayamtech/912-SVM-LIB-UI.git</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition><hudson.model.StringParameterDefinition><name>PORTAL_BRANCH</name><defaultValue>prod</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>'
IDENT_PARAMS='<hudson.model.StringParameterDefinition><name>IAM_DEPLOY_DIR</name><defaultValue></defaultValue><trim>false</trim></hudson.model.StringParameterDefinition><hudson.model.StringParameterDefinition><name>IMAGE_TAG_OVERRIDE</name><defaultValue></defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>'
# knowledge deploy params (beyond AGENT_LABEL/DEPLOY_ENV/SKIP_PROD_APPROVAL the template adds):
# the host dir holding the per-env .env, and a rollback tag override. (PRJ-014 #93.)
KNOWLEDGE_PARAMS='<hudson.model.StringParameterDefinition><name>KNOWLEDGE_DEPLOY_DIR</name><defaultValue></defaultValue><trim>false</trim></hudson.model.StringParameterDefinition><hudson.model.StringParameterDefinition><name>IMAGE_TAG_OVERRIDE</name><defaultValue></defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>'

echo "=== ensuring parent folder ${PARENT} ==="
SSH "mkdir -p $JH/jobs/$PARENT"
folder_xml "Svayam PRJ-012 governance: build / deploy / ops jobs (new deploy design). Pre-redesign jobs live under Archived/." | PUT "$JH/jobs/$PARENT/config.xml"

echo "=== creating folders ==="
for spec in \
  "build|Build immutable artifacts (lib publish / docker image), build-once-promote" \
  "build/jobs/image|Docker images (svm-ident, portal-spa) — build once to a :sha tag" \
  "build/jobs/lib|Library publish jobs (npm.svayamtech.com)" \
  "deploy|Deploy a pinned artifact to an environment (per-service, per-env)" \
  "deploy/jobs/svm-ident|svm-ident broker deploy jobs" \
  "deploy/jobs/portal-spa|Portal SPA deploy jobs" \
  "deploy/jobs/knowledge|Knowledge platform deploy jobs (qdrant+ollama+rag-api+site)" \
  "ops|start/stop/reconcile lifecycle jobs" \
  "ops/jobs/svm-ident|svm-ident lifecycle (start/stop)"; do
  path="${spec%%|*}"; desc="${spec#*|}"
  SSH "mkdir -p $JOBROOT/$path"
  folder_xml "$desc" | PUT "$JOBROOT/$path/config.xml"
  echo "  folder: $path"
done

echo "=== creating deploy jobs ==="
mkjob() {  # $1=job-dir $2=desc $3=repo $4=scriptPath $5=env $6=params $7=agent_label_override(optional)
  SSH "mkdir -p $JOBROOT/$1"
  deploy_job_xml "$2" "$3" "$4" "$5" "$6" "${7:-}" | PUT "$JOBROOT/$1/config.xml"
  echo "  job: ${1//jobs\//}"
}
mkjob deploy/jobs/svm-ident/jobs/uat  "Deploy svm-ident to UAT (security-uat)." "$R911" "packages/libraries/ts/svm-ident/Jenkinsfile.deploy" staging    "$IDENT_PARAMS"
mkjob deploy/jobs/svm-ident/jobs/prod "Deploy svm-ident to PROD (security)."    "$R911" "packages/libraries/ts/svm-ident/Jenkinsfile.deploy" production "$IDENT_PARAMS"
mkjob deploy/jobs/portal-spa/jobs/uat  "Deploy Portal SPA to UAT (portal-uat)." "$R911" "deploy/portal/Jenkinsfile.deploy" staging    "$PORTAL_PARAMS_UAT"
mkjob deploy/jobs/portal-spa/jobs/prod "Deploy Portal SPA to PROD (portal)."    "$R911" "deploy/portal/Jenkinsfile.deploy" production "$PORTAL_PARAMS_PROD"
# knowledge: dev/uat/prod all colocate on chinhut (DEC-003) → pin AGENT_LABEL=chinhut for every env.
mkjob deploy/jobs/knowledge/jobs/uat  "Deploy knowledge to UAT (knowledge-uat.svayamtech.com)." "$R911" "deploy/knowledge/Jenkinsfile.deploy" staging    "$KNOWLEDGE_PARAMS" chinhut
mkjob deploy/jobs/knowledge/jobs/prod "Deploy knowledge to PROD (knowledge.svayamtech.com)."    "$R911" "deploy/knowledge/Jenkinsfile.deploy" production "$KNOWLEDGE_PARAMS" chinhut

echo "=== creating build/image jobs (build-once -> :sha) ==="
mkbuild() {  # $1=job-dir $2=desc $3=repo $4=scriptPath
  SSH "mkdir -p $JOBROOT/$1"
  build_job_xml "$2" "$3" "$4" | PUT "$JOBROOT/$1/config.xml"
  echo "  build job: ${1//jobs\//}"
}
mkbuild build/jobs/image/jobs/svm-ident "Build the svm-ident IAM image once; push docker.svayamtech.com/svayam/svm-ident tagged by commit sha (build-once-promote)." "$R911" "deploy/build/Jenkinsfile.image-svm-ident"
mkbuild build/jobs/image/jobs/portal-spa "Build the Portal SPA image once; push docker.svayamtech.com/svayam/portal-spa tagged by commit sha (build-once-promote)." "$R912" "1-apps/portal/Jenkinsfile.build"
mkbuild build/jobs/image/jobs/knowledge "Build the knowledge-api image once; push docker.svayamtech.com/svayam/knowledge-api tagged by commit sha (build-once-promote)." "$R911" "deploy/build/Jenkinsfile.image-knowledge"

echo "=== creating dev deploy jobs (Jenkinsfiles now support development; dev IAM host TODO) ==="
mkjob deploy/jobs/svm-ident/jobs/dev  "Deploy svm-ident to DEV." "$R911" "packages/libraries/ts/svm-ident/Jenkinsfile.deploy" development "$IDENT_PARAMS"
mkjob deploy/jobs/knowledge/jobs/dev  "Deploy knowledge to DEV (knowledge-dev.svayamtech.com)." "$R911" "deploy/knowledge/Jenkinsfile.deploy" development "$KNOWLEDGE_PARAMS" chinhut
PORTAL_PARAMS_DEV='<hudson.model.StringParameterDefinition><name>PORTAL_REPO</name><defaultValue>git@github.com:Svayamtech/912-SVM-LIB-UI.git</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition><hudson.model.StringParameterDefinition><name>PORTAL_BRANCH</name><defaultValue>dev</defaultValue><trim>false</trim></hudson.model.StringParameterDefinition>'
mkjob deploy/jobs/portal-spa/jobs/dev "Deploy Portal SPA to DEV." "$R911" "deploy/portal/Jenkinsfile.deploy" development "$PORTAL_PARAMS_DEV"

echo "=== creating build/lib publish jobs ==="
mklib() {  # $1=job-dir $2=desc $3=repo $4=scriptPath $5=LIB_DIR $6=PUBLISH_DIR
  SSH "mkdir -p $JOBROOT/$1"
  lib_job_xml "$2" "$3" "$4" "$5" "$6" | PUT "$JOBROOT/$1/config.xml"
  echo "  lib job: ${1//jobs\//}"
}
mklib build/jobs/lib/jobs/iam-client "Publish @svayam/iam-client to npm.svayamtech.com." "$R911" "deploy/build/Jenkinsfile.lib" "packages/libraries/ts/iam-client" "."
mklib build/jobs/lib/jobs/iam-ui     "Publish @svayam/iam-ui to npm.svayamtech.com." "$R912" "deploy/build/Jenkinsfile.lib" "packages/libraries/angular/iam-ui" "dist"

echo "=== creating ops/svm-ident/{start,stop} jobs ==="
mkjob ops/jobs/svm-ident/jobs/start "Start svm-ident (no migrate; replica-safe)." "$R911" "packages/libraries/ts/svm-ident/Jenkinsfile.start" production "$IDENT_PARAMS"
mkjob ops/jobs/svm-ident/jobs/stop  "Stop svm-ident."                              "$R911" "packages/libraries/ts/svm-ident/Jenkinsfile.stop"  production "$IDENT_PARAMS"

# NOTE: pre-redesign flat jobs (DEPLOY_*/START_*/STOP_*) were a ONE-TIME migration —
# relocated under ${PARENT}/Archived/ (Jenkins "Move", history preserved), not managed
# here. A fresh install has none. To re-run that move see scripts/deploy/jenkins-reorg.sh.

echo "=== reload Jenkins config from disk ==="
bash "$(dirname "$0")/jenkins.sh" reload || echo "  (reload via API failed — reload manually: Manage Jenkins -> Reload Configuration from Disk)"
echo "DONE. New structure under ${PARENT}/: build/{image,lib}/*, deploy/{svm-ident,portal-spa,knowledge}/{dev,uat,prod}, ops/svm-ident/{start,stop}."
