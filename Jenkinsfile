/*
 * Jenkinsfile — publish @svayam-opensource/prj (the prj CLI) to public npm
 * (registry.npmjs.org, --access public).
 *
 * Single-package repo: the package IS the repo root (package.json + bin/prj +
 * the bundled bash CLI + framework content assets). No build step — prj is bash,
 * so the "build" is a correctness gate (syntax + version-sync + npm pack).
 *
 * Triggers:
 *   - Manual (Build with Parameters): pick BRANCH_TO_BUILD + DEPLOY_ENV.
 *   - Webhook on the publish branch (typically main).
 *
 * dist-tag: DEPLOY_ENV=prod → --tag latest; dev/uat → --tag <env>.
 *
 * NOTE: npm refuses to republish an existing version. Bump with
 * scripts/bump-version.sh <x.y.z> (keeps package.json / framework/VERSION /
 * .framework-version in sync) before a prod publish.
 *
 * Credentials (configured in Jenkins — values never live in the repo):
 *   - GIT_CREDENTIALS_ID      : ssh key with read access to this repo
 *   - NPM_TOKEN_CREDENTIALS_ID: npmjs automation token (Secret text), used with
 *     NPMRC_AUTH_MODE=token (_authToken).
 */

def GIT_REPO_URL             = 'git@github.com:svayam-opensource/governed-agentic-dev-framework.git'
def GIT_CREDENTIALS_ID       = 'jenkins-chinhut'
def NPM_REGISTRY             = 'https://registry.npmjs.org/'   // public OSS registry
def NPM_TOKEN_CREDENTIALS_ID = 'admin-svayam'                  // npmjs automation token (Secret text)
def NPM_AUTH_EMAIL           = 'admin@svayam.ai'
def NPMRC_AUTH_MODE          = 'token'   // npmjs uses _authToken

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
  }

  parameters {
    string(name: 'BRANCH_TO_BUILD', defaultValue: 'main',
           description: 'Git branch to publish the CLI from.')
    choice(name: 'DEPLOY_ENV', choices: ['prod', 'uat', 'dev'],
           description: 'prod → npm dist-tag "latest"; dev/uat → dist-tag "<env>".')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout([
          $class: 'GitSCM',
          branches: [[name: "*/${params.BRANCH_TO_BUILD}"]],
          extensions: [],
          userRemoteConfigs: [[
            credentialsId: GIT_CREDENTIALS_ID,
            url: GIT_REPO_URL
          ]]
        ])
      }
    }

    stage('Gate — framework correctness') {
      steps {
        // The npm package ships the CLI (prj + scripts/ + agent/ + setup.sh) —
        // NOT the org knowledge/registry/projects. So gate on CLI correctness
        // + packaging only: bash syntax of every shipped script, and that the
        // tarball builds. (scripts/validate/run.py validates ORG content and is
        // the org repo's own CI, not a CLI-publish gate; e2e_smoke.sh Phase 2
        // needs a GH PAT + fixture project and is a maintainer step.)
        sh '''
          set -e
          for f in prj scripts/*.sh scripts/validate/*.py ci/jenkins/*.sh install.sh setup.sh bin/prj; do
            case "$f" in *.py) python3 -m py_compile "$f" ;; *) bash -n "$f" ;; esac
          done
          # Version must agree across package.json, framework/VERSION,
          # .framework-version (and README diagram URLs must stay @latest).
          # Blocks the publish on any drift.
          python3 scripts/validate/check_version_sync.py
          npm pack --dry-run >/dev/null
        '''
      }
    }

    stage('Publish to npm registry') {
      steps {
        script {
          def regUrl  = NPM_REGISTRY.replaceAll(/\/$/, '') + '/'
          def host    = regUrl.replaceAll(/^https?:\/\//, '').replaceAll(/\/$/, '')
          def distTag = (params.DEPLOY_ENV == 'prod') ? 'latest' : params.DEPLOY_ENV

          def pkgRaw = sh(
            script: 'node -e \'const j=require("./package.json");process.stdout.write(j.name+"\\n"+j.version)\'',
            returnStdout: true
          ).trim()
          def parts      = pkgRaw.split('\n', 2)
          def pkgName    = parts[0] ?: ''
          def pkgVersion = parts.size() > 1 ? parts[1] : ''
          def scopeAt    = pkgName.split('/')[0]

          def npmrcEnv = [
            "NPMRC_SCOPE_LINE=${scopeAt}:registry=${regUrl}",
            "NPMRC_REGISTRY_LINE=registry=${regUrl}",
            "NPMRC_HOST=${host}",
            "NPMRC_EMAIL=${NPM_AUTH_EMAIL}",
            "NPMRC_AUTH_MODE=${NPMRC_AUTH_MODE}",
            "WRITE_NPMRC_SH=${env.WORKSPACE}/ci/jenkins/write-publish-npmrc.sh",
          ]

          withEnv(npmrcEnv) {
            withCredentials([
              string(credentialsId: NPM_TOKEN_CREDENTIALS_ID, variable: 'NPM_AUTH_B64')
            ]) {
              dir(env.WORKSPACE) {
                sh 'bash "$WRITE_NPMRC_SH"'
                sh "npm publish --ignore-scripts --access public --tag ${distTag} --registry=${regUrl}"
              }
            }
          }
          echo "Published ${pkgName}@${pkgVersion} (--tag ${distTag})"
        }
      }
    }
  }

  post {
    always {
      // Remove the publish .npmrc (contains the token). A declarative post block
      // already runs in the workspace, so no dir() wrapper — that wrapper was
      // throwing in the post context and marking otherwise-successful publishes
      // as FAILURE (firing the failure{} echo below on a good publish).
      sh 'rm -f .npmrc || true'
    }
    failure {
      echo 'Publish failed — scroll up for the first npm error (a duplicate version is the most common cause; bump version in package.json).'
    }
  }
}
