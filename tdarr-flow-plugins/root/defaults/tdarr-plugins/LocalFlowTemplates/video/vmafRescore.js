'use strict';
/* eslint-disable no-template-curly-in-string */
/* eslint-disable import/prefer-default-export */
// VMAF Rescore (new flow, 2026-11-19): scores a finished file against the file named by its own TDARR_SOURCE_FILE tag and writes the result into the finished file's TDARR_VMAF_SCORE tag. It does not encode, remux or replace anything.
// Path: Input File, Route to VMAF node (Tags: Worker Type, CPU or GPU worker on a node tagged vmaf, so the reference is read where Run VMAF runs), Read Source File Tag (sets the Flow Variable sourceFile; fails the job when the tag is missing, when no file exists at that path on this node, or when that file is the working file itself), Check Video Resolution and Check 10 Bit Video (the same branching as the Encoder's VMAF branch), one of four Run VMAF Quality Check nodes with Reference file {{{args.variables.user.sourceFile}}}, then Tag VMAF Score on both the pass and the fail output (the score is recorded either way; Run VMAF's minimums are left at the plugin defaults and only decide which output is used).
// The working file is the input file itself (no copy into the work folder), so Tag VMAF Score edits the library file in place with mkvpropedit; it keeps the file's other TDARR_ tags and does not touch streams. Matroska files only.
// details() carries the flow's own _id (the first field below), as the other templates do. Adding this file from Add Flow > Local was reported to prompt Replace when a flow with this _id already exists.
Object.defineProperty(exports, '__esModule', { value: true });
exports.details = void 0;
const details = () => ({
    "_id": "bdelima/VmafRescore",
    "name": "VMAF Rescore",
    "description": "VMAF Rescore",
    "tags": "",
    "flowPlugins": [
      {
        "name": "Input File",
        "sourceRepo": "Community",
        "pluginName": "inputFile",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsInput",
        "position": {
          "x": 0,
          "y": 0
        }
      },
      {
        "name": "Route to VMAF node",
        "sourceRepo": "Community",
        "pluginName": "tagsWorkerType",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsRoute",
        "position": {
          "x": 0,
          "y": 72
        },
        "inputsDB": {
          "requiredWorkerType": "CPUorGPU",
          "requiredNodeTags": "vmaf"
        }
      },
      {
        "name": "Read Source File Tag",
        "sourceRepo": "Local",
        "pluginName": "readSourceFileTag",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsReadSrc",
        "position": {
          "x": 0,
          "y": 144
        }
      },
      {
        "name": "Check Video Resolution",
        "sourceRepo": "Community",
        "pluginName": "checkVideoResolution",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsRes",
        "position": {
          "x": 0,
          "y": 216
        }
      },
      {
        "name": "Check 10 Bit Video",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsBit",
        "position": {
          "x": -120,
          "y": 312
        }
      },
      {
        "name": "Check 10 Bit Video (4k)",
        "sourceRepo": "Community",
        "pluginName": "check10Bit",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsBit4k",
        "position": {
          "x": 240,
          "y": 312
        }
      },
      {
        "name": "Run VMAF Quality Check (8 bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsVmaf8",
        "position": {
          "x": -240,
          "y": 408
        },
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.sourceFile}}}",
          "pixelFormat": "yuv420p"
        }
      },
      {
        "name": "Run VMAF Quality Check (10 bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsVmaf10",
        "position": {
          "x": -48,
          "y": 408
        },
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.sourceFile}}}",
          "pixelFormat": "yuv420p10le"
        }
      },
      {
        "name": "Run VMAF Quality Check (4K, 8 bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsVmaf4k8",
        "position": {
          "x": 144,
          "y": 408
        },
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.sourceFile}}}",
          "pixelFormat": "yuv420p",
          "model": "vmaf_4k_v0.6.1"
        }
      },
      {
        "name": "Run VMAF Quality Check (4K, 10 bit)",
        "sourceRepo": "Local",
        "pluginName": "runVmaf",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsVmaf4k10",
        "position": {
          "x": 336,
          "y": 408
        },
        "inputsDB": {
          "referenceFile": "{{{args.variables.user.sourceFile}}}",
          "pixelFormat": "yuv420p10le",
          "model": "vmaf_4k_v0.6.1"
        }
      },
      {
        "name": "Tag VMAF Score",
        "sourceRepo": "Local",
        "pluginName": "tagVmafScore",
        "version": "1.0.0",
        "fpEnabled": true,
        "id": "rsTag",
        "position": {
          "x": 48,
          "y": 504
        }
      }
    ],
    "flowEdges": [
      {
        "source": "rsInput",
        "sourceHandle": "1",
        "target": "rsRoute",
        "targetHandle": null,
        "id": "rsE01"
      },
      {
        "source": "rsRoute",
        "sourceHandle": "1",
        "target": "rsReadSrc",
        "targetHandle": null,
        "id": "rsE02"
      },
      {
        "source": "rsReadSrc",
        "sourceHandle": "1",
        "target": "rsRes",
        "targetHandle": null,
        "id": "rsE03"
      },
      {
        "source": "rsRes",
        "sourceHandle": "1",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes1"
      },
      {
        "source": "rsRes",
        "sourceHandle": "2",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes2"
      },
      {
        "source": "rsRes",
        "sourceHandle": "3",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes3"
      },
      {
        "source": "rsRes",
        "sourceHandle": "4",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes4"
      },
      {
        "source": "rsRes",
        "sourceHandle": "5",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes5"
      },
      {
        "source": "rsRes",
        "sourceHandle": "8",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes8"
      },
      {
        "source": "rsRes",
        "sourceHandle": "9",
        "target": "rsBit",
        "targetHandle": null,
        "id": "rsRes9"
      },
      {
        "source": "rsRes",
        "sourceHandle": "6",
        "target": "rsBit4k",
        "targetHandle": null,
        "id": "rsRes6"
      },
      {
        "source": "rsRes",
        "sourceHandle": "7",
        "target": "rsBit4k",
        "targetHandle": null,
        "id": "rsRes7"
      },
      {
        "source": "rsBit",
        "sourceHandle": "1",
        "target": "rsVmaf10",
        "targetHandle": null,
        "id": "rsBit1"
      },
      {
        "source": "rsBit",
        "sourceHandle": "2",
        "target": "rsVmaf8",
        "targetHandle": null,
        "id": "rsBit2"
      },
      {
        "source": "rsBit4k",
        "sourceHandle": "1",
        "target": "rsVmaf4k10",
        "targetHandle": null,
        "id": "rsBit4k1"
      },
      {
        "source": "rsBit4k",
        "sourceHandle": "2",
        "target": "rsVmaf4k8",
        "targetHandle": null,
        "id": "rsBit4k2"
      },
      {
        "source": "rsVmaf8",
        "sourceHandle": "1",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf8Pass"
      },
      {
        "source": "rsVmaf8",
        "sourceHandle": "2",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf8Fail"
      },
      {
        "source": "rsVmaf10",
        "sourceHandle": "1",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf10Pass"
      },
      {
        "source": "rsVmaf10",
        "sourceHandle": "2",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf10Fail"
      },
      {
        "source": "rsVmaf4k8",
        "sourceHandle": "1",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf4k8Pass"
      },
      {
        "source": "rsVmaf4k8",
        "sourceHandle": "2",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf4k8Fail"
      },
      {
        "source": "rsVmaf4k10",
        "sourceHandle": "1",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf4k10Pass"
      },
      {
        "source": "rsVmaf4k10",
        "sourceHandle": "2",
        "target": "rsTag",
        "targetHandle": null,
        "id": "rsVmaf4k10Fail"
      }
    ]
  });
exports.details = details;
