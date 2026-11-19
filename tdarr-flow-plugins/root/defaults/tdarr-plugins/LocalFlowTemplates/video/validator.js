'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// Live Tdarr flow "Muxer" (original flow _id: Yaax7LBej; it was called "Validator" until 2026-11-18), brought up to Bob's live "Muxer (v14)" on 2026-11-18 (the version suffix is stamped on at image build, so the name here stays plain). It puts the audio+subs file back together with the video-only file (mkvmerge Execute in combine mode), routes the job to the node that does the merge, and ends in Tag Output Metadata and Replace Original File. The VMAF nodes, the 4K and 10-bit checks and the Require Review node that the older Validator template had are not in the live flow, so they are not here.
// Entry from Encoder Flow (re-encoded) (QgTm1GUmZ) goes to Classify Source (ViEmkfGP4); its outputs 2, 4, 6, 8 and 10 (the HDR and Dolby Vision classes) go to the Dolby Vision / HDR10+ re-injection, the others (1, 3, 5, 7, 9) to the merge as before. Entry from Controller Flow (final merge) (FShP88xbjPT) goes straight to the merge. After the merge both paths go through Compare File Duration Ratio, Queue Full Healthcheck and Run Thorough Health Check, the Require health check before Replace gate, Route to local node and Mark step, then Tag Output Metadata and Replace Original File.
// Dolby Vision / HDR10+ re-injection, added 2026-11-18: Route to a local node (injRoute, CPU worker, tags mapped,local), Mark step validator-inject-start (injMark), then one node per step, each a Local plugin (DoVi/HDR: Look In Source, HDR10+: Extract From Source, Dolby Vision: Extract RPU From Source, DoVi/HDR: Count Encode Frames, Dolby Vision: Check RPU Frame Count, DoVi/HDR: Write Raw HEVC Stream, HDR10+: Inject Into Stream, Dolby Vision: Inject RPU Into Stream, DoVi/HDR: Mux To MKV, DoVi/HDR: Verify Result, DoVi/HDR: Clean Up Work Files). A source with neither goes straight on to the merge; Profile 4, Profile 5 and any other unsupported Dolby Vision profile, a frame count mismatch, metadata that does not fit the stream and a failed read-back go to Fail Flow. The steps share their results in the Flow Variables user.inj*; the working file is the re-encode and the Flow Variable videoOnlySource is the video-only file it was made from.
// details() carries the flow's own _id (the first field below), because the goToFlow nodes in the other flows point at
// it by id. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists;
// to update a live flow in place, paste its JSON, with the same _id, into Import JSON Flow Template and choose Replace.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "Yaax7LBej",
    "name": "Muxer",
    "description": "Muxer",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Entry from Encoder Flow (re-encoded)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "QgTm1GUmZ",
        "position": {
          "x": 1512,
          "y": -144
        }
      },
      {
        "name": "Fail Flow",
        "sourceRepo": "Community",
        "pluginName": "failFlow",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "WrieN1BV1",
        "position": {
          "x": 792,
          "y": 240
        }
      },
      {
        "name": "Tag Output Metadata",
        "sourceRepo": "Local",
        "pluginName": "tagOutputMetadata",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "tagOutMeta",
        "position": {
          "x": 1140,
          "y": 420
        }
      },
      {
        "name": "Replace Original File",
        "sourceRepo": "Community",
        "pluginName": "replaceOriginalFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "1g5GNL1MP",
        "position": {
          "x": 1140,
          "y": 456
        }
      },
      {
        "name": "Entry from Controller Flow (final merge)",
        "sourceRepo": "Community",
        "pluginName": "comment",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "FShP88xbjPT",
        "position": {
          "x": 1020,
          "y": -144
        }
      },
      {
        "name": "Compare File Duration Ratio (passthrough)",
        "sourceRepo": "Community",
        "pluginName": "compareFileDurationRatio",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "CUsET8PD3PT",
        "position": {
          "x": 1008,
          "y": 60
        }
      },
      {
        "name": "Queue Full Healthcheck",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "GPU",
          "requiredNodeTags": "healthcheck-full"
        },
        "fpEnabled": true,
        "id": "reqOjochalHC",
        "position": {
          "x": 1164,
          "y": 144
        }
      },
      {
        "name": "Run Thorough Health Check",
        "sourceRepo": "Community",
        "pluginName": "runHealthCheck",
        "version": "1.0.0",
        "inputsDB": {
          "type": "thorough",
          "gpuAcceleration": "qsv"
        },
        "fpEnabled": true,
        "id": "healthCheckPT",
        "position": {
          "x": 1416,
          "y": 204
        }
      },
      {
        "name": "Mark step: landed for health check",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-queue"
        },
        "fpEnabled": true,
        "id": "valMarkHcQueue",
        "position": {
          "x": 1416,
          "y": 156
        }
      },
      {
        "name": "Mark step: thorough health check done",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valMarkHcDone",
        "position": {
          "x": 1416,
          "y": 252
        }
      },
      {
        "name": "Require health check before Replace",
        "sourceRepo": "Local",
        "pluginName": "requireTrail",
        "version": "1.0.0",
        "inputsDB": {
          "requiredLabels": "validator-hc-queue,validator-hc-done"
        },
        "fpEnabled": true,
        "id": "valRequireHc",
        "position": {
          "x": 1164,
          "y": 228
        }
      },
      {
        "name": "Mark step: on vmaf node",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-on-local"
        },
        "fpEnabled": true,
        "id": "JbNGlNa6-",
        "position": {
          "x": 1140,
          "y": 384
        }
      },
      {
        "name": "Route to local node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped,local"
        },
        "fpEnabled": true,
        "id": "rvn34_UFh",
        "position": {
          "x": 1140,
          "y": 348
        }
      },
      {
        "name": "Route to local node (merge)",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredNodeTags": "mapped,local",
          "requiredWorkerType": "CPU"
        },
        "fpEnabled": true,
        "id": "valRoutePT",
        "position": {
          "x": 1188,
          "y": -84
        }
      },
      {
        "name": "Mark step: on local node (merge)",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-merged-pt"
        },
        "fpEnabled": true,
        "id": "valMarkPT",
        "position": {
          "x": 1188,
          "y": -48
        }
      },
      {
        "name": "mkvmerge (final combine)",
        "sourceRepo": "Local",
        "pluginName": "mkvmergeExecute",
        "version": "1.0.0",
        "inputsDB": {
          "mode": "combine",
          "audioSubsDir": "/temp/.tdarr-remux-cache"
        },
        "fpEnabled": true,
        "id": "valMergePT",
        "position": {
          "x": 1188,
          "y": 0
        }
      },
      {
        "name": "Cleanup audio+subs cache file",
        "sourceRepo": "Community",
        "pluginName": "runCli",
        "version": "1.0.0",
        "inputsDB": {
          "useCustomCliPath": "true",
          "userCli": "mkvmerge",
          "customCliPath": "/bin/sh",
          "doesCommandCreateOutputFile": "false",
          "cliArguments": "-c rm -f \"/temp/.tdarr-remux-cache/{{{args.originalLibraryFile.fileNameWithoutExtension}}}-audiosubs.mkv\"",
          "outputFileBecomesWorkingFile": "false"
        },
        "fpEnabled": true,
        "id": "valCleanPT",
        "position": {
          "x": 1188,
          "y": 36
        }
      },
      {
        "name": "Classify Source",
        "sourceRepo": "Local",
        "pluginName": "classifySource",
        "version": "1.0.0",
        "id": "ViEmkfGP4",
        "position": {
          "x": 1512,
          "y": -96
        },
        "fpEnabled": true
      },
      {
        "name": "Route to local node (inject)",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "inputsDB": {
          "requiredWorkerType": "CPU",
          "requiredNodeTags": "mapped,local"
        },
        "fpEnabled": true,
        "id": "injRoute",
        "position": {
          "x": 1740,
          "y": -96
        }
      },
      {
        "name": "Mark step: on local node (inject)",
        "sourceRepo": "Local",
        "pluginName": "markStep",
        "version": "1.0.0",
        "inputsDB": {
          "label": "validator-inject-start"
        },
        "fpEnabled": true,
        "id": "injMark",
        "position": {
          "x": 1740,
          "y": -48
        }
      },
      {
        "name": "DoVi/HDR: Look In Source",
        "sourceRepo": "Local",
        "pluginName": "doviLookInSource",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injLook",
        "position": {
          "x": 1740,
          "y": 0
        }
      },
      {
        "name": "HDR10+: Extract From Source",
        "sourceRepo": "Local",
        "pluginName": "hdr10PlusExtract",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injHdrX",
        "position": {
          "x": 1620,
          "y": 72
        }
      },
      {
        "name": "Dolby Vision: Extract RPU From Source",
        "sourceRepo": "Local",
        "pluginName": "doviExtractRpu",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRpuX",
        "position": {
          "x": 1860,
          "y": 72
        }
      },
      {
        "name": "DoVi/HDR: Count Encode Frames",
        "sourceRepo": "Local",
        "pluginName": "doviCountFrames",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injCount",
        "position": {
          "x": 1740,
          "y": 144
        }
      },
      {
        "name": "Dolby Vision: Check RPU Frame Count",
        "sourceRepo": "Local",
        "pluginName": "doviCheckRpuFrames",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injCheck",
        "position": {
          "x": 1860,
          "y": 216
        }
      },
      {
        "name": "DoVi/HDR: Write Raw HEVC Stream",
        "sourceRepo": "Local",
        "pluginName": "doviWriteRawStream",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRaw",
        "position": {
          "x": 1740,
          "y": 288
        }
      },
      {
        "name": "HDR10+: Inject Into Stream",
        "sourceRepo": "Local",
        "pluginName": "hdr10PlusInject",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injHdrI",
        "position": {
          "x": 1620,
          "y": 360
        }
      },
      {
        "name": "Dolby Vision: Inject RPU Into Stream",
        "sourceRepo": "Local",
        "pluginName": "doviInjectRpu",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injRpuI",
        "position": {
          "x": 1860,
          "y": 432
        }
      },
      {
        "name": "DoVi/HDR: Mux To MKV",
        "sourceRepo": "Local",
        "pluginName": "doviMuxResult",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injMux",
        "position": {
          "x": 1740,
          "y": 504
        }
      },
      {
        "name": "DoVi/HDR: Verify Result",
        "sourceRepo": "Local",
        "pluginName": "doviVerifyResult",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injVerify",
        "position": {
          "x": 1740,
          "y": 552
        }
      },
      {
        "name": "DoVi/HDR: Clean Up Work Files",
        "sourceRepo": "Local",
        "pluginName": "doviCleanUp",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "injClean",
        "position": {
          "x": 1740,
          "y": 600
        }
      }
    ],
    "flowEdges": [
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "U2MS0RqpEPT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "6FytNy0H9PT"
      },
      {
        "source": "CUsET8PD3PT",
        "sourceHandle": "1",
        "target": "reqOjochalHC",
        "targetHandle": null,
        "id": "ratioToReqOjochal"
      },
      {
        "source": "reqOjochalHC",
        "sourceHandle": "1",
        "target": "valMarkHcQueue",
        "targetHandle": null,
        "id": "reqOjochalToHC"
      },
      {
        "source": "healthCheckPT",
        "sourceHandle": "1",
        "target": "valMarkHcDone",
        "targetHandle": null,
        "id": "hcToReqLocal"
      },
      {
        "source": "valMarkHcQueue",
        "sourceHandle": "1",
        "target": "healthCheckPT",
        "targetHandle": null,
        "id": "reqOjochalToHCb"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "gateToFail"
      },
      {
        "source": "valMarkHcDone",
        "sourceHandle": "1",
        "target": "valRequireHc",
        "targetHandle": null,
        "id": "iR16UZ4VY"
      },
      {
        "source": "tagOutMeta",
        "sourceHandle": "1",
        "target": "1g5GNL1MP",
        "targetHandle": null,
        "id": "451iXsWSo"
      },
      {
        "source": "valRequireHc",
        "sourceHandle": "1",
        "target": "rvn34_UFh",
        "targetHandle": null,
        "id": "jJ00OkqOj"
      },
      {
        "source": "rvn34_UFh",
        "sourceHandle": "1",
        "target": "JbNGlNa6-",
        "targetHandle": null,
        "id": "OYzhHw0HF"
      },
      {
        "source": "JbNGlNa6-",
        "sourceHandle": "1",
        "target": "tagOutMeta",
        "targetHandle": null,
        "id": "_DTW22_4d"
      },
      {
        "source": "FShP88xbjPT",
        "sourceHandle": "1",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "ePT0"
      },
      {
        "source": "valRoutePT",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "ePT1"
      },
      {
        "source": "valMarkPT",
        "sourceHandle": "1",
        "target": "valMergePT",
        "targetHandle": null,
        "id": "ePT2"
      },
      {
        "source": "valMergePT",
        "sourceHandle": "1",
        "target": "valCleanPT",
        "targetHandle": null,
        "id": "ePT3"
      },
      {
        "source": "valCleanPT",
        "sourceHandle": "1",
        "target": "CUsET8PD3PT",
        "targetHandle": null,
        "id": "jFFhjdPsv"
      },
      {
        "source": "QgTm1GUmZ",
        "sourceHandle": "1",
        "target": "ViEmkfGP4",
        "targetHandle": null,
        "id": "k5-6oq4s7"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "1",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "pujIC4cNc"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "3",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "vW8eDUflT"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "5",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "KSKJj_p0A"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "7",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "A3zSeIXBl"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "9",
        "target": "valRoutePT",
        "targetHandle": null,
        "id": "9t8RwjZmA"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "2",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE00"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "4",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE01"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "6",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE02"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "8",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE03"
      },
      {
        "source": "ViEmkfGP4",
        "sourceHandle": "10",
        "target": "injRoute",
        "targetHandle": null,
        "id": "injE04"
      },
      {
        "source": "injRoute",
        "sourceHandle": "1",
        "target": "injMark",
        "targetHandle": null,
        "id": "injE05"
      },
      {
        "source": "injMark",
        "sourceHandle": "1",
        "target": "injLook",
        "targetHandle": null,
        "id": "injE06"
      },
      {
        "source": "injLook",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "injE07"
      },
      {
        "source": "injLook",
        "sourceHandle": "2",
        "target": "injHdrX",
        "targetHandle": null,
        "id": "injE08"
      },
      {
        "source": "injLook",
        "sourceHandle": "3",
        "target": "injRpuX",
        "targetHandle": null,
        "id": "injE09"
      },
      {
        "source": "injLook",
        "sourceHandle": "4",
        "target": "injHdrX",
        "targetHandle": null,
        "id": "injE10"
      },
      {
        "source": "injLook",
        "sourceHandle": "5",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "injE11"
      },
      {
        "source": "injHdrX",
        "sourceHandle": "1",
        "target": "injRpuX",
        "targetHandle": null,
        "id": "injE12"
      },
      {
        "source": "injHdrX",
        "sourceHandle": "2",
        "target": "injCount",
        "targetHandle": null,
        "id": "injE13"
      },
      {
        "source": "injRpuX",
        "sourceHandle": "1",
        "target": "injCount",
        "targetHandle": null,
        "id": "injE14"
      },
      {
        "source": "injCount",
        "sourceHandle": "1",
        "target": "injCheck",
        "targetHandle": null,
        "id": "injE15"
      },
      {
        "source": "injCount",
        "sourceHandle": "2",
        "target": "injRaw",
        "targetHandle": null,
        "id": "injE16"
      },
      {
        "source": "injCheck",
        "sourceHandle": "1",
        "target": "injRaw",
        "targetHandle": null,
        "id": "injE17"
      },
      {
        "source": "injCheck",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "injE18"
      },
      {
        "source": "injRaw",
        "sourceHandle": "1",
        "target": "injHdrI",
        "targetHandle": null,
        "id": "injE19"
      },
      {
        "source": "injRaw",
        "sourceHandle": "2",
        "target": "injRpuI",
        "targetHandle": null,
        "id": "injE20"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "1",
        "target": "injRpuI",
        "targetHandle": null,
        "id": "injE21"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "2",
        "target": "injMux",
        "targetHandle": null,
        "id": "injE22"
      },
      {
        "source": "injHdrI",
        "sourceHandle": "3",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "injE23"
      },
      {
        "source": "injRpuI",
        "sourceHandle": "1",
        "target": "injMux",
        "targetHandle": null,
        "id": "injE24"
      },
      {
        "source": "injRpuI",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "injE25"
      },
      {
        "source": "injMux",
        "sourceHandle": "1",
        "target": "injVerify",
        "targetHandle": null,
        "id": "injE26"
      },
      {
        "source": "injVerify",
        "sourceHandle": "1",
        "target": "injClean",
        "targetHandle": null,
        "id": "injE27"
      },
      {
        "source": "injVerify",
        "sourceHandle": "2",
        "target": "WrieN1BV1",
        "targetHandle": null,
        "id": "injE28"
      },
      {
        "source": "injClean",
        "sourceHandle": "1",
        "target": "valMarkPT",
        "targetHandle": null,
        "id": "injE29"
      }
    ]
  });
exports.details = details;
